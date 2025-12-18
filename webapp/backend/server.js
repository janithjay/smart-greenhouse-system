const express = require('express');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const awsIot = require('aws-iot-device-sdk');
const AWS = require('aws-sdk');
const { CognitoJwtVerifier } = require("aws-jwt-verify");
const cors = require('cors');
const path = require('path');
const dns = require('dns');
require('dotenv').config();

// Fix for Node.js 17+ IPv6 issues
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

// --- Configuration ---
const PORT = process.env.PORT || 3001;
const AWS_IOT_ENDPOINT = process.env.AWS_IOT_ENDPOINT;
const DEVICE_NAME = 'GreenHouse_Hub'; // Name for this backend connection

// --- AWS SDK Setup (DynamoDB) ---
AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
const docClient = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = "GreenhouseUserDevices";

// --- Cognito Verifier ---
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: "id",
  clientId: process.env.COGNITO_CLIENT_ID,
  httpOptions: {
    responseTimeout: 10000 // Wait 10 seconds instead of 3
  }
});

// Warm up the verifier (fetch JWKS) at startup
verifier.hydrate()
  .then(() => console.log("✅ Cognito JWKS loaded successfully"))
  .catch(err => console.error("❌ Failed to load Cognito JWKS (Check Internet/VPN):", err.message));

// --- Express & Socket.io Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// --- Middleware: Verify Cognito Token ---
const verifyAuth = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const payload = await verifier.verify(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    console.error("Token verification failed:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
};

// --- API Endpoints ---

// 1. Get User's Devices
app.get('/api/devices', verifyAuth, async (req, res) => {
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: { ":uid": req.user.id }
  };

  try {
    const data = await docClient.query(params).promise();
    res.json(data.Items);
  } catch (err) {
    console.error("DynamoDB Error:", err);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// 2. Add Device
app.post('/api/devices', verifyAuth, async (req, res) => {
  const { deviceId, name } = req.body;
  if (!deviceId) return res.status(400).json({ error: "Device ID required" });

  const params = {
    TableName: TABLE_NAME,
    Item: {
      userId: req.user.id,
      deviceId: deviceId,
      name: name || deviceId,
      createdAt: Date.now()
    }
  };

  try {
    await docClient.put(params).promise();
    res.json({ success: true, device: params.Item });
  } catch (err) {
    console.error("DynamoDB Error:", err);
    res.status(500).json({ error: "Failed to add device" });
  }
});

// 3. Update Device Name
app.put('/api/devices/:deviceId', verifyAuth, async (req, res) => {
  const { deviceId } = req.params;
  const { name } = req.body;

  const params = {
    TableName: TABLE_NAME,
    Key: {
      userId: req.user.id,
      deviceId: deviceId
    },
    UpdateExpression: "set #n = :n",
    ExpressionAttributeNames: { "#n": "name" },
    ExpressionAttributeValues: { ":n": name },
    ReturnValues: "UPDATED_NEW"
  };

  try {
    await docClient.update(params).promise();
    res.json({ success: true });
  } catch (err) {
    console.error("DynamoDB Error:", err);
    res.status(500).json({ error: "Failed to update device" });
  }
});

// 4. Remove Device
app.delete('/api/devices/:deviceId', verifyAuth, async (req, res) => {
  const params = {
    TableName: TABLE_NAME,
    Key: {
      userId: req.user.id,
      deviceId: req.params.deviceId
    }
  };

  try {
    await docClient.delete(params).promise();
    res.json({ success: true });
  } catch (err) {
    console.error("DynamoDB Error:", err);
    res.status(500).json({ error: "Failed to remove device" });
  }
});

// Load Self-Signed Certs for HTTPS
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem'))
};

const server = https.createServer(sslOptions, app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for now (or specify frontend URL)
    methods: ["GET", "POST"]
  }
});

// --- AWS IoT Setup ---
// We expect certificates to be in a 'certs' folder
// Check if certs exist before trying to connect
// const fs = require('fs'); // Already imported
const certsExist = fs.existsSync(path.join(__dirname, 'certs', 'private.pem.key')) &&
                   fs.existsSync(path.join(__dirname, 'certs', 'certificate.pem.crt')) &&
                   fs.existsSync(path.join(__dirname, 'certs', 'AmazonRootCA1.pem'));

// --- State ---
let lastSensorData = {
    temp: 0, hum: 0, soil: 0, co2: 0, tank_level: 0, 
    pump: 0, fan: 0, heater: 0, mode: 'AUTO', timestamp: Date.now()
};
let deviceOnline = false;
let lastHeartbeat = 0;

let device;

if (certsExist && AWS_IOT_ENDPOINT) {
    device = awsIot.device({
        keyPath: path.join(__dirname, 'certs', 'private.pem.key'),
        certPath: path.join(__dirname, 'certs', 'certificate.pem.crt'),
        caPath: path.join(__dirname, 'certs', 'AmazonRootCA1.pem'),
        clientId: DEVICE_NAME,
        host: AWS_IOT_ENDPOINT
    });

    // --- AWS IoT Events ---
    device.on('connect', () => {
        console.log('✅ Connected to AWS IoT Core');
        // Subscribe to ALL devices using wildcard '+'
        device.subscribe('greenhouse/+/data', (err) => {
             if (err) {
                 console.error('❌ Subscribe Error:', err);
             } else {
                 console.log('✅ Subscribed to greenhouse/+/data');
             }
        });
    });

    device.on('message', (topic, payload) => {
        const message = payload.toString();
        // console.log('Message received:', topic, message);

        // Topic format: greenhouse/{device_id}/data
        const topicParts = topic.split('/');
        if (topicParts.length === 3 && topicParts[2] === 'data') {
            const deviceId = topicParts[1];
            try {
                const data = JSON.parse(message);
                
                // Broadcast ONLY to clients listening to this device
                io.to(deviceId).emit('sensor-data', data);
                io.to(deviceId).emit('device-status', { online: true });
                
                // Store last known data for this device (optional, for quick load)
                // In a real app, use a DB (Redis/DynamoDB)
                // deviceDataStore[deviceId] = data; 
            } catch (e) {
                console.error('Error parsing JSON:', e);
            }
        }
    });

    device.on('error', (error) => {
        console.error('❌ AWS IoT Error:', error);
    });
} else {
    console.log('⚠️ AWS IoT Certificates or Endpoint missing. Running in Simulation Mode.');
}

// --- Heartbeat Monitor ---
setInterval(() => {
    const now = Date.now();
    // If no data for 15 seconds, consider device offline
    if (deviceOnline && (now - lastHeartbeat > 15000)) {
        deviceOnline = false;
        io.emit('device-status', { online: false });
        console.log('⚠️ Device marked OFFLINE (Timeout)');
    }
}, 5000);

// --- Socket.io Events (Frontend Communication) ---
io.on('connection', (socket) => {
  console.log('👤 Web Client Connected:', socket.id);

  // Handle Device Selection (Login)
  socket.on('join-device', (deviceId) => {
      console.log(`Socket ${socket.id} joining device room: ${deviceId}`);
      socket.join(deviceId); // Join a room named after the Device ID
      socket.deviceId = deviceId; // Store ID on socket object for reference
  });

  // Handle Control Commands from Frontend
  socket.on('control-command', (command) => {
    if (!socket.deviceId) return; // Ignore if not logged in
    console.log(`Command for ${socket.deviceId}:`, command);
    
    if (device) {
        // Publish to specific device topic
        const topic = `greenhouse/${socket.deviceId}/commands`;
        device.publish(topic, JSON.stringify(command));
    }
  });

  // Handle Config Updates
  socket.on('config-update', (config) => {
    if (!socket.deviceId) return;
    console.log(`Config Update for ${socket.deviceId}:`, config);
    
    // --- Input Validation ---
    const isValid = (
        (config.temp_min === undefined || (config.temp_min >= 0 && config.temp_min <= 100)) &&
        (config.temp_max === undefined || (config.temp_max >= 0 && config.temp_max <= 100)) &&
        (config.hum_max === undefined || (config.hum_max >= 0 && config.hum_max <= 100)) &&
        (config.soil_dry === undefined || (config.soil_dry >= 0 && config.soil_dry <= 100)) &&
        (config.soil_wet === undefined || (config.soil_wet >= 0 && config.soil_wet <= 100)) &&
        (config.tank_empty_dist === undefined || (config.tank_empty_dist > 0 && config.tank_empty_dist < 1000)) &&
        (config.tank_full_dist === undefined || (config.tank_full_dist > 0 && config.tank_full_dist < 1000))
    );

    if (!isValid) {
        console.error('❌ Invalid Configuration Values Received:', config);
        socket.emit('config-error', { message: 'Invalid values! Ranges (0 - 100), Tank distance (0 - 1000)'});
        return; // Do not send to device
    }

    if (device) {
        const topic = `greenhouse/${socket.deviceId}/commands`;
        device.publish(topic, JSON.stringify(config));
    }
  });

  socket.on('disconnect', () => {
    console.log('Web Client Disconnected');
  });
});

// --- Start Server ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend running on https://localhost:${PORT}`);
});
