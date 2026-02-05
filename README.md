# 🌱 Smart Greenhouse System

A comprehensive IoT-based greenhouse automation system that monitors environmental conditions and controls climate parameters automatically. The system consists of an ESP32-based hardware controller, a Node.js backend bridge, and a React web application for real-time monitoring and control.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Hardware Requirements](#hardware-requirements)
- [Software Requirements](#software-requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)
- [License](#license)

## 🌟 Overview

The Smart Greenhouse System provides automated climate control for greenhouse environments by monitoring temperature, humidity, soil moisture, air quality (CO2 and TVOC), and water tank levels. It automatically controls heating, ventilation, and irrigation systems to maintain optimal growing conditions.

## ✨ Features

### Environmental Monitoring
- **Temperature & Humidity**: Real-time monitoring using AHT20 sensor
- **Air Quality**: CO2 and TVOC measurements via ENS160 sensor
- **Soil Moisture**: Capacitive soil moisture sensing with calibration
- **Water Level**: Ultrasonic sensor for water tank level monitoring

### Automated Control
- **Climate Control**: Automatic heating and cooling based on temperature thresholds
- **Humidity Management**: Exhaust fan activation for humidity control
- **Smart Irrigation**: Automatic watering based on soil moisture levels
- **Manual Override**: Full manual control mode for all actuators

### Connectivity & Interface
- **WiFi Management**: Easy WiFi configuration via captive portal (WiFiManager)
- **AWS IoT Integration**: Secure MQTT communication with AWS IoT Core
- **Real-time Dashboard**: Web-based monitoring and control interface
- **LCD Display**: Local 20x4 character display for status information
- **OTA Updates**: Over-the-air firmware updates

### Data Management
- **Offline Data Storage**: Local data buffering when connectivity is lost
- **Historical Data**: Time-series data storage and visualization
- **Device Shadow**: AWS IoT Device Shadow for state synchronization

## 🏗️ Architecture

The system consists of three main components:

```
┌─────────────────┐       MQTT/WSS        ┌──────────────────┐
│   ESP32 Device  │ ◄──────────────────► │   AWS IoT Core   │
│  (Firmware)     │                       │                  │
└─────────────────┘                       └────────┬─────────┘
                                                   │
                                                   │
                                          ┌────────▼─────────┐
                                          │  Node.js Backend │
                                          │    (Bridge)      │
                                          └────────┬─────────┘
                                                   │ WebSocket
                                                   │
                                          ┌────────▼─────────┐
                                          │  React Frontend  │
                                          │   (Dashboard)    │
                                          └──────────────────┘
```

### 1. ESP32 Firmware (PlatformIO/Arduino)
- Multi-threaded FreeRTOS design
- Sensor reading and actuator control
- MQTT communication with AWS IoT
- Local LCD interface
- Persistent configuration storage

### 2. Node.js Backend
- Bridge between AWS IoT and web frontend
- Real-time WebSocket server
- REST API for device management
- AWS Cognito authentication integration
- Historical data retrieval

### 3. React Frontend
- Real-time dashboard with live sensor data
- Interactive charts and graphs (Recharts)
- Device control interface
- User authentication (AWS Amplify)
- Responsive design

## 🔧 Hardware Requirements

### ESP32 Components
- **Microcontroller**: ESP32 DOIT DevKit V1
- **Temperature/Humidity**: Adafruit AHT20 sensor
- **Air Quality**: ScioSense ENS160 sensor
- **Display**: 20x4 I2C LCD (Address: 0x27)
- **Soil Moisture**: Capacitive soil moisture sensor
- **Water Level**: HC-SR04 ultrasonic sensor
- **Actuators**:
  - Water pump (relay-controlled)
  - Exhaust fan (relay-controlled)
  - Heater/halogen lamp (relay-controlled)

### Pin Configuration
```
PIN 26 - Water Pump Relay
PIN 27 - Exhaust Fan Relay
PIN 14 - Heater Relay
PIN 5  - Ultrasonic Trigger
PIN 34 - Ultrasonic Echo
PIN 32 - Soil Moisture Analog
PIN 4  - WiFi Reset Button
```

## 💻 Software Requirements

### ESP32 Firmware
- PlatformIO IDE or PlatformIO Core
- ESP32 Arduino framework
- Libraries (auto-installed via PlatformIO):
  - Adafruit AHTX0
  - ENS160 Driver
  - LiquidCrystal I2C
  - PubSubClient (MQTT)
  - ArduinoJson
  - WiFiManager

### Backend
- Node.js 16.x or higher
- npm or yarn

### Frontend
- Node.js 16.x or higher
- npm or yarn
- Modern web browser

### Cloud Services
- AWS Account with:
  - AWS IoT Core
  - AWS Cognito
  - Amazon DynamoDB (for data storage)

## 📦 Installation

### 1. ESP32 Firmware Setup

#### Install PlatformIO
```bash
# Using PlatformIO IDE (VS Code Extension) or
pip install platformio
```

#### Configure Secrets
Create `src/secrets.h` with your AWS IoT credentials:
```cpp
// WiFi Credentials (Optional - can use WiFiManager portal)
const char* WIFI_SSID = "your-wifi-ssid";
const char* WIFI_PASS = "your-wifi-password";

// AWS IoT Endpoint
const char* AWS_IOT_ENDPOINT = "your-endpoint.iot.region.amazonaws.com";

// Device Certificate
const char AWS_CERT_CRT[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
your-device-certificate
-----END CERTIFICATE-----
)EOF";

// Device Private Key
const char AWS_CERT_PRIVATE[] PROGMEM = R"EOF(
-----BEGIN RSA PRIVATE KEY-----
your-private-key
-----END RSA PRIVATE KEY-----
)EOF";

// Amazon Root CA 1
const char AWS_CERT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
your-root-ca
-----END CERTIFICATE-----
)EOF";
```

#### Build and Upload
```bash
cd /path/to/smart-greenhouse-system
platformio run --target upload
platformio device monitor  # View serial output
```

### 2. Backend Setup

```bash
cd webapp/backend

# Install dependencies
npm install

# Create .env file
cat > .env << EOF
PORT=3001
NODE_ENV=development

# AWS IoT Configuration
AWS_REGION=us-east-1
AWS_IOT_ENDPOINT=your-endpoint.iot.region.amazonaws.com
AWS_IOT_THING_NAME=your-thing-name

# AWS Cognito Configuration
AWS_COGNITO_USER_POOL_ID=your-user-pool-id
AWS_COGNITO_CLIENT_ID=your-client-id

# AWS Credentials (for SDK)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
EOF

# Start the server
npm start

# Or for development with auto-reload
npm run dev
```

### 3. Frontend Setup

```bash
cd webapp/frontend

# Install dependencies
npm install

# Create .env file
cat > .env << EOF
VITE_API_URL=https://localhost:3001
VITE_WS_URL=wss://localhost:3001

# AWS Amplify Configuration
VITE_AWS_REGION=us-east-1
VITE_AWS_USER_POOL_ID=your-user-pool-id
VITE_AWS_USER_POOL_WEB_CLIENT_ID=your-client-id
EOF

# Start development server
npm run dev

# Or build for production
npm run build
```

## ⚙️ Configuration

### ESP32 Configuration

The ESP32 stores configuration in non-volatile storage (NVS). Default parameters:

```cpp
FIRMWARE_VERSION = "1.0.0"
TEMP_MIN_NIGHT = 20.0°C   // Heater activates below this
TEMP_MAX_DAY = 30.0°C     // Fan activates above this
HUM_MAX = 75.0%           // Fan activates above this
SOIL_DRY = 40%            // Pump activates below this
SOIL_WET = 70%            // Pump deactivates above this
TANK_EMPTY_DIST = 25cm    // Empty tank threshold
TANK_FULL_DIST = 5cm      // Full tank threshold
```

These can be updated via the web dashboard or MQTT commands.

### WiFi Configuration

**First Time Setup:**
1. Power on the ESP32
2. Look for WiFi network "SmartGreenhouse-XXXXXX"
3. Connect and configure your WiFi credentials
4. Device will save credentials and auto-reconnect

**Reset WiFi:**
- Hold the reset button (PIN 4) for 5 seconds

### AWS IoT Setup

1. Create an IoT Thing in AWS IoT Core
2. Generate and download certificates
3. Create an IoT Policy with appropriate permissions
4. Attach policy to certificate
5. Update `secrets.h` with credentials

### Backend SSL Certificates (Development)

The backend uses HTTPS in development mode. Generate self-signed certificates:
```bash
cd webapp/backend
mkdir -p certs
cd certs
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

**Note:** The frontend is also configured with HTTPS via `@vitejs/plugin-basic-ssl`. You may need to accept the self-signed certificate warnings in your browser during development.

## 🚀 Usage

### Web Dashboard

1. Start the backend server
2. Start the frontend application
3. Navigate to `https://localhost:5173` (or your configured URL)
4. Sign in with AWS Cognito credentials
5. View real-time sensor data and control devices

### Manual vs Automatic Mode

**Automatic Mode** (Default):
- System automatically controls actuators based on sensor readings and thresholds
- Optimal for hands-off operation

**Manual Mode**:
- Override automatic control
- Manually toggle pump, fan, and heater
- Useful for testing or special situations

### LCD Display

The local LCD shows:
- Line 1: Temperature and Humidity
- Line 2: Soil Moisture and Water Level
- Line 3: CO2 and TVOC levels
- Line 4: WiFi and AWS connection status

### MQTT Topics

**Subscribe (Device receives commands):**
- `greenhouse/{deviceId}/command` - Control commands
- `greenhouse/{deviceId}/config` - Configuration updates
- `$aws/things/{deviceId}/shadow/update/delta` - Shadow updates

**Publish (Device sends data):**
- `greenhouse/{deviceId}/telemetry` - Sensor data
- `greenhouse/{deviceId}/status` - Device status
- `$aws/things/{deviceId}/shadow/update` - Shadow updates

## 📚 API Documentation

### REST Endpoints

#### Health Check
```
GET /health
Response: "OK"
```

#### Get Device Status
```
GET /api/devices/:deviceId/status
Response: {
  temperature: number,
  humidity: number,
  soilMoisture: number,
  eco2: number,
  tvoc: number,
  waterLevel: number,
  pumpStatus: boolean,
  fanStatus: boolean,
  heaterStatus: boolean,
  manualMode: boolean
}
```

#### Send Command
```
POST /api/devices/:deviceId/command
Body: {
  action: "pump" | "fan" | "heater" | "mode",
  value: boolean | "auto" | "manual"
}
```

#### Get Historical Data
```
GET /api/devices/:deviceId/history?startTime=...&endTime=...
Response: Array of telemetry records
```

### WebSocket Events

**Client → Server:**
- `subscribe` - Subscribe to device updates
- `command` - Send device command

**Server → Client:**
- `telemetry` - Real-time sensor data
- `status` - Device status update
- `error` - Error message

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Built with PlatformIO and Arduino framework
- Uses AWS IoT Core for cloud connectivity
- React and Vite for modern web interface
- Various open-source libraries and sensors

## 📞 Support

For issues, questions, or contributions, please open an issue on GitHub.

---

**Made with ❤️ for sustainable agriculture and IoT innovation**
