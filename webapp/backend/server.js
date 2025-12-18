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
        device.subscribe('greenhouse/data', (err) => {
             if (err) {
                 console.error('❌ Subscribe Error:', err);
             } else {
                 console.log('✅ Subscribed to greenhouse/data');
             }
        });
    });

    device.on('message', (topic, payload) => {
        const message = payload.toString();
        console.log('Message received:', topic, message);

        if (topic === 'greenhouse/data') {
            try {
                const data = JSON.parse(message);
                
                // Update heartbeat
                lastHeartbeat = Date.now();
                if (!deviceOnline) {
                    deviceOnline = true;
                    io.emit('device-status', { online: true });
                    console.log('✅ Device marked ONLINE');
                }

                lastSensorData = data;
                // Broadcast to all connected web clients
                io.emit('sensor-data', data);
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

  // Send immediate initial state
  socket.emit('sensor-data', lastSensorData);
  socket.emit('device-status', { online: deviceOnline });

  // Handle Control Commands from Frontend
  socket.on('control-command', (command) => {
    console.log('Received Command:', command);
    
    if (device) {
        // Publish to AWS IoT (Firmware subscribes to 'greenhouse/commands')
        device.publish('greenhouse/commands', JSON.stringify(command));
    } else {
        console.log('Simulating Command (No AWS):', command);
    }
  });

  // Handle Config Updates
  socket.on('config-update', (config) => {
    console.log('Received Config Update:', config);
    
    // --- Input Validation ---
    const isValid = (
        (config.temp_min === undefined || (config.temp_min >= 0 && config.temp_min <= 100)) &&
        (config.temp_max === undefined || (config.temp_max >= 0 && config.temp_max <= 100)) &&
        (config.hum_max === undefined || (config.hum_max >= 0 && config.hum_max <= 100)) &&
        (config.soil_dry === undefined || (config.soil_dry >= 0 && config.soil_dry <= 100)) &&
        (config.soil_wet === undefined || (config.soil_wet >= 0 && config.soil_wet <= 100))
    );

    if (!isValid) {
        console.error('❌ Invalid Configuration Values Received:', config);
        socket.emit('config-error', { message: 'Invalid values! Values must be 0 - 100' });
        return; // Do not send to device
    }

    if (device) {
        device.publish('greenhouse/commands', JSON.stringify(config));
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
