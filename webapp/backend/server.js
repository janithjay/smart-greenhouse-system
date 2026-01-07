const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// --- Configuration ---
const MONGODB_URI = process.env.MONGODB_URI;

// --- MongoDB Setup ---
// Cache connection for Vercel hot-starts
let isConnected = false;
const connectDB = async () => {
    if (isConnected) return;
    try {
        await mongoose.connect(MONGODB_URI);
        isConnected = true;
        console.log("✅ Connected to MongoDB");
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err);
    }
};

// Ensure connection on every request
const app = express();
app.use(async (req, res, next) => {
    await connectDB();
    next();
});

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
app.get('/', (req, res) => {
    res.json({ 
        status: "Online", 
        service: "Smart Greenhouse Backend", 
        version: "1.0.0",
        endpoints: [
            "/api/devices",
            "/api/history/:deviceId",
            "/api/alerts/:deviceId",
            "/api/ingest"
        ]
    });
});

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

// --- Server Setup (Serverless) ---
// For Vercel, we export the app. No need to create HTTP/Socket.io servers.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
      console.log(`Server running locally on port ${PORT}`);
  });
}




// 7. Ingest Sensor Data (Called by ESP32/IoT Device via HTTP)
app.post('/api/ingest', async (req, res) => {
  const { deviceId, data } = req.body;
  
  if (!deviceId || !data) {
     return res.status(400).json({ error: "Missing deviceId or data" });
  }

  try {
     // Save History
     if (data.temp !== undefined) {
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
     }

     // Save Alerts
     if (data.alert) {
         const newAlert = new Alert({
            deviceId: deviceId,
            timestamp: data.timestamp || Math.floor(Date.now() / 1000),
            alert: data.alert,
            message: data.message
         });
         await newAlert.save();
     }
     
     res.json({ success: true });
  } catch (err) {
     console.error("Ingest Error:", err);
     res.status(500).json({ error: "Failed to ingest data" });
  }
});

module.exports = app;
