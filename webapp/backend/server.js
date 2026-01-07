const express = require('express');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const mongoose = require('mongoose');
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
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MONGODB_URI = process.env.MONGODB_URI;

// --- MongoDB Setup ---
mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- Schemas ---
const DeviceSchema = new mongoose.Schema({
  userId: String,
  deviceId: String,
  name: String,
  createdAt: { type: Date, default: Date.now }
});
const Device = mongoose.model('Device', DeviceSchema);

const HistorySchema = new mongoose.Schema({
  deviceId: String,
  timestamp: Number,
  temp: Number,
  hum: Number,
  soil: Number,
  co2: Number,
  tank_level: Number,
  pump: Number,
  fan: Number,
  heater: Number,
  mode: String,
  version: String
});
const History = mongoose.model('History', HistorySchema);

const AlertSchema = new mongoose.Schema({
  deviceId: String,
  timestamp: Number,
  alert: String,
  message: String
});
const Alert = mongoose.model('Alert', AlertSchema);

// --- Express & Socket.io Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// --- Middleware: Simple Auth (Placeholder) ---
// Since we removed Cognito, we'll use a simple pass-through or a basic token check for now.
// For production with free tier, consider Firebase Auth later.
const verifyAuth = async (req, res, next) => {
  // TODO: Implement replacement Auth (e.g. Firebase)
  // For now, we assume a header "x-user-id" is sent from frontend for testing
  const userId = req.headers['x-user-id'] || "test-user";
  req.user = { id: userId };
  next();
};

// --- API Endpoints ---

// 1. Get User's Devices
app.get('/api/devices', verifyAuth, async (req, res) => {
  try {
    const devices = await Device.find({ userId: req.user.id });
    res.json(devices);
  } catch (err) {
    console.error("MongoDB Error:", err);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// 2. Add Device
app.post('/api/devices', verifyAuth, async (req, res) => {
  const { deviceId, name } = req.body;
  if (!deviceId) return res.status(400).json({ error: "Device ID required" });

  try {
    const newDevice = await Device.findOneAndUpdate(
      { userId: req.user.id, deviceId: deviceId },
      { name: name || deviceId, createdAt: Date.now() },
      { upsert: true, new: true }
    );
    res.json({ success: true, device: newDevice });
  } catch (err) {
    console.error("MongoDB Error:", err);
    res.status(500).json({ error: "Failed to add device" });
  }
});

// 3. Update Device Name
app.put('/api/devices/:deviceId', verifyAuth, async (req, res) => {
  const { deviceId } = req.params;
  const { name } = req.body;

  try {
    await Device.updateOne(
      { userId: req.user.id, deviceId: deviceId },
      { name: name }
    );
    res.json({ success: true });
  } catch (err) {
    console.error("MongoDB Error:", err);
    res.status(500).json({ error: "Failed to update device" });
  }
});

// 4. Remove Device
app.delete('/api/devices/:deviceId', verifyAuth, async (req, res) => {
  try {
    await Device.deleteOne({ userId: req.user.id, deviceId: req.params.deviceId });
    res.json({ success: true });
  } catch (err) {
    console.error("MongoDB Error:", err);
    res.status(500).json({ error: "Failed to delete device" });
  }
});

// 5. Get Device Last Status (for Offline View)
app.get('/api/devices/:deviceId/status', verifyAuth, async (req, res) => {
  const { deviceId } = req.params;
  
  try {
    const lastStatus = await History.findOne({ deviceId: deviceId }).sort({ timestamp: -1 });
    res.json(lastStatus || {});
  } catch (err) {
    console.error("MongoDB Error:", err);
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

// 5. Get Device Alerts
app.get('/api/alerts/:deviceId', verifyAuth, async (req, res) => {
  const { deviceId } = req.params;
  
  try {
    const alerts = await Alert.find({ deviceId: deviceId }).sort({ timestamp: -1 }).limit(20);
    res.json(alerts);
  } catch (err) {
    console.error("MongoDB Error:", err);
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

// 6. Get Device History
app.get('/api/history/:deviceId', verifyAuth, async (req, res) => {
  const { deviceId } = req.params;
  const { start, end } = req.query;

  // Default: Last 24 hours if no range provided
  let startTime = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
  let endTime = Math.floor(Date.now() / 1000);

  if (start) startTime = parseInt(start);
  if (end) endTime = parseInt(end);

  try {
    const history = await History.find({
      deviceId: deviceId,
      timestamp: { $gte: startTime, $lte: endTime }
    }).sort({ timestamp: 1 });
    res.json(history);
  } catch (err) {
    console.error("MongoDB History Error:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// --- Server Setup (HTTP for Prod, HTTPS for Dev) ---
let server;
if (process.env.NODE_ENV === 'production') {
  const http = require('http');
  server = http.createServer(app);
  console.log('🚀 Running in PRODUCTION mode (HTTP)');
} else {
  // Load Self-Signed Certs for HTTPS (Local Development)
  const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem'))
  };
  server = https.createServer(sslOptions, app);
  console.log('🚀 Running in DEVELOPMENT mode (HTTPS)');
}

const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for now (or specify frontend URL)
    methods: ["GET", "POST"]
  }
});

// --- MQTT Setup (HiveMQ) ---
let mqttClient;

if (MQTT_BROKER_URL) {
  const mqttOptions = {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    protocol: 'mqtts', // Secure MQTT
    port: 8883,
    rejectUnauthorized: false // Allow self-signed certs (or HiveMQ's public certs)
  };

  mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

  mqttClient.on('connect', () => {
    console.log('✅ Connected to HiveMQ Broker');
    // Subscribe to ALL devices
    mqttClient.subscribe('greenhouse/+/data');
    mqttClient.subscribe('greenhouse/+/alerts');
    console.log('✅ Subscribed to greenhouse/+/data & alerts');
  });

  mqttClient.on('message', async (topic, payload) => {
    const message = payload.toString();
    const topicParts = topic.split('/');

    // 1. Handle Sensor Data
    if (topicParts.length === 3 && topicParts[2] === 'data') {
      const deviceId = topicParts[1];
      try {
        const data = JSON.parse(message);

        // Broadcast to frontend
        io.to(deviceId).emit('sensor-data', data);
        io.to(deviceId).emit('device-status', { online: true });

        // Save to MongoDB
        const newHistory = new History({
          deviceId: deviceId,
          timestamp: data.timestamp || Math.floor(Date.now() / 1000),
          temp: data.temp,
          hum: data.hum,
          soil: data.soil,
          co2: data.co2,
          tank_level: data.tank_level,
          pump: data.pump,
          fan: data.fan,
          heater: data.heater,
          mode: data.mode,
          version: data.version
        });
        await newHistory.save();

      } catch (e) {
        console.error('Error parsing JSON:', e);
      }
    }

    // 2. Handle Alerts
    if (topicParts.length === 3 && topicParts[2] === 'alerts') {
      const deviceId = topicParts[1];
      try {
        const alertData = JSON.parse(message);
        console.log(`🚨 ALERT from ${deviceId}:`, alertData);
        io.to(deviceId).emit('device-alert', alertData);

        // Save to MongoDB
        const newAlert = new Alert({
          deviceId: deviceId,
          timestamp: alertData.timestamp || Math.floor(Date.now() / 1000),
          alert: alertData.alert,
          message: alertData.message
        });
        await newAlert.save();

      } catch (e) {
        console.error('Error parsing Alert JSON:', e);
      }
    }
  });

  mqttClient.on('error', (error) => {
    console.error('❌ MQTT Error:', error);
  });
} else {
  console.log('⚠️ MQTT Credentials missing. Running in Simulation Mode.');
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
    
    if (mqttClient) {
        // Publish to specific device topic
        const topic = `greenhouse/${socket.deviceId}/commands`;
        mqttClient.publish(topic, JSON.stringify(command));
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

    if (mqttClient) {
        const topic = `greenhouse/${socket.deviceId}/commands`;
        mqttClient.publish(topic, JSON.stringify(config));
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
