const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const awsIot = require('aws-iot-device-sdk');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// --- Configuration ---
const PORT = process.env.PORT || 3001;
const AWS_IOT_ENDPOINT = process.env.AWS_IOT_ENDPOINT;
const DEVICE_NAME = 'GreenHouse_Hub'; // Name for this backend connection

// --- Express & Socket.io Setup ---
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for now (or specify frontend URL)
    methods: ["GET", "POST"]
  }
});

// --- AWS IoT Setup ---
// We expect certificates to be in a 'certs' folder
// Check if certs exist before trying to connect
const fs = require('fs');
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
server.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
