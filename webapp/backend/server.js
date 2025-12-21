const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const dns = require('dns');
require('dotenv').config();

// Import Modules
const apiRoutes = require('./routes/api');
const { initIoT, publishCommand } = require('./services/iotService');

// Fix for Node.js 17+ IPv6 issues
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const PORT = process.env.PORT || 3001;

// --- Express Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// --- Routes ---
app.use('/api', apiRoutes);

// --- Server Setup (HTTP for Prod, HTTPS for Dev) ---
let server;
if (process.env.NODE_ENV === 'production') {
  server = http.createServer(app);
  console.log('🚀 Running in PRODUCTION mode (HTTP)');
} else {
  // Load Self-Signed Certs for HTTPS (Local Development)
  try {
      const sslOptions = {
        key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem'))
      };
      server = https.createServer(sslOptions, app);
      console.log('🚀 Running in DEVELOPMENT mode (HTTPS)');
  } catch (e) {
      console.error("❌ Failed to load SSL certs. Fallback to HTTP.");
      server = http.createServer(app);
  }
}

// --- Socket.io Setup ---
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Initialize AWS IoT Service
initIoT(io);

// --- Socket.io Events ---
io.on('connection', (socket) => {
  console.log('👤 Web Client Connected:', socket.id);

  // Handle Device Selection (Login)
  socket.on('join-device', (deviceId) => {
      console.log(`Socket ${socket.id} joining device room: ${deviceId}`);
      socket.join(deviceId);
      socket.deviceId = deviceId;
  });

  // Handle Control Commands
  socket.on('control-command', (command) => {
    if (!socket.deviceId) return;
    console.log(`Command for ${socket.deviceId}:`, command);
    publishCommand(socket.deviceId, command);
  });

  // Handle Config Updates
  socket.on('config-update', (config) => {
    if (!socket.deviceId) return;
    console.log(`Config Update for ${socket.deviceId}:`, config);
    
    // Basic Validation
    const isValid = (
        (config.temp_min === undefined || (config.temp_min >= 0 && config.temp_min <= 100)) &&
        (config.temp_max === undefined || (config.temp_max >= 0 && config.temp_max <= 100))
    );

    if (!isValid) {
        socket.emit('config-error', { message: 'Invalid values!'});
        return;
    }

    publishCommand(socket.deviceId, config);
  });

  socket.on('disconnect', () => {
    console.log('Web Client Disconnected');
  });
});

// --- Start Server ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
