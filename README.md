# 🌱 Smart Greenhouse System

A comprehensive IoT-based greenhouse automation system that monitors environmental conditions and controls climate parameters automatically. The system consists of an ESP32-based hardware controller, a **serverless AWS Lambda backend**, and a React web application for real-time monitoring and control — deployed on **Vercel** with live data pushed via **Pusher Channels**.

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
- **Real-time Dashboard**: Web-based monitoring and control interface with live updates via Pusher
- **LCD Display**: Local 20x4 character display for status information
- **OTA Updates**: Over-the-air firmware updates

### Data Management
- **Offline Data Storage**: Local data buffering when connectivity is lost
- **Historical Data**: Time-series data stored in DynamoDB and visualized in the dashboard
- **Alerts**: Automatic alerts saved to DynamoDB and pushed live to the frontend

## 🏗️ Architecture

The system uses a fully **serverless** backend — there is no always-on server. All backend logic runs in AWS Lambda functions triggered by IoT Rules or API Gateway.

```
┌─────────────────┐    MQTT (TLS)    ┌──────────────────────┐
│   ESP32 Device  │ ───────────────► │    AWS IoT Core      │
│  (Firmware)     │ ◄─────────────── │  (IoT Rules Engine)  │
└─────────────────┘   MQTT commands  └──────┬───────┬────────┘
                                            │       │
                          IoT Rule trigger  │       │ IoT Rule trigger
                                            ▼       ▼
                              ┌─────────────────┐ ┌──────────────────┐
                              │ iot-data-handler│ │iot-alert-handler │
                              │   (Lambda)      │ │   (Lambda)       │
                              └────────┬────────┘ └────────┬─────────┘
                                       │                   │
                              DynamoDB │                   │ DynamoDB
                              (sensor  │                   │ (alerts)
                               data)   │                   │
                                       ▼                   ▼
                              ┌──────────────────────────────────┐
                              │        Pusher Channels           │
                              │   (real-time push to frontend)   │
                              └──────────────────┬───────────────┘
                                                 │
                              ┌──────────────────▼───────────────┐
                              │         React Frontend           │
                              │  (Vercel — pusher-js + Amplify)  │
                              └──────────────────▲───────────────┘
                                                 │ REST calls
                              ┌──────────────────┴───────────────┐
                              │   API Gateway HTTP API           │
                              │   → api-handler (Lambda)         │
                              │   (devices / history / command)  │
                              └──────────────────────────────────┘
```

### 1. ESP32 Firmware (PlatformIO/Arduino)
- Multi-threaded FreeRTOS design
- Sensor reading and actuator control
- MQTT communication with AWS IoT Core
- Publishes sensor data to `greenhouse/{deviceId}/data`
- Publishes alerts to `greenhouse/{deviceId}/alerts`
- Subscribes to commands on `greenhouse/{deviceId}/commands`
- Local LCD interface
- Persistent configuration storage (NVS)

### 2. Serverless Backend (AWS Lambda)

Three independent Lambda functions replace the previous always-on Node.js server:

| Function | Trigger | Responsibility |
|---|---|---|
| `iot-data-handler` | IoT Rule — `greenhouse/+/data` | Save sensor data to DynamoDB and push live update via Pusher |
| `iot-alert-handler` | IoT Rule — `greenhouse/+/alerts` | Save alert to DynamoDB and push alert via Pusher |
| `api-handler` | API Gateway HTTP API | REST API — device management, history, commands, alerts |

**DynamoDB Tables:**
- `GreenhouseUserDevices` — user-to-device associations
- `GreenhouseSensorData` — time-series sensor readings
- `GreenhouseAlerts` — device alerts log

### 3. Pusher Channels (Real-time Push)
- `iot-data-handler` and `iot-alert-handler` push events to Pusher after saving to DynamoDB
- The frontend subscribes to the `greenhouse-{deviceId}` Pusher channel
- Events: `sensor-data`, `device-status`, `device-alert`
- Replaces the previous WebSocket server entirely — no persistent server needed

### 4. React Frontend (Vercel)
- Real-time dashboard with live sensor data via `pusher-js`
- Interactive charts and graphs (Recharts)
- Device control interface
- User authentication (AWS Amplify + Cognito)
- Deployed on **Vercel**

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

### Lambda Functions
- Node.js 18.x or higher (AWS Lambda runtime)
- npm (for installing dependencies before zipping)

### Frontend
- Node.js 18.x or higher
- npm or yarn
- Modern web browser

### Cloud Services
- **AWS Account** with:
  - AWS IoT Core (MQTT broker + IoT Rules)
  - AWS Lambda (3 functions)
  - AWS API Gateway HTTP API
  - AWS Cognito (User Pool + App Client)
  - Amazon DynamoDB (3 tables)
- **Pusher** account — free tier is sufficient ([pusher.com](https://pusher.com))
- **Vercel** account for frontend hosting ([vercel.com](https://vercel.com))

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

### 2. AWS Setup

#### DynamoDB Tables
Create the following tables in DynamoDB:

| Table Name | Partition Key | Sort Key |
|---|---|---|
| `GreenhouseUserDevices` | `userId` (String) | `deviceId` (String) |
| `GreenhouseSensorData` | `deviceId` (String) | `timestamp` (Number) |
| `GreenhouseAlerts` | `deviceId` (String) | `timestamp` (Number) |

#### IoT Rules
Create two IoT Rules in AWS IoT Core:

**Rule 1 — Sensor Data:**
- SQL: `SELECT *, topic() AS topicName FROM 'greenhouse/+/data'`
- Action: Invoke Lambda → `iot-data-handler`

**Rule 2 — Alerts:**
- SQL: `SELECT *, topic() AS topicName FROM 'greenhouse/+/alerts'`
- Action: Invoke Lambda → `iot-alert-handler`

### 3. Lambda Functions Setup

Each Lambda function is deployed independently. For each function under `webapp/lambdas/`:

```bash
# Example for iot-data-handler (repeat for iot-alert-handler and api-handler)
cd webapp/lambdas/iot-data-handler
npm install

# Zip and upload to AWS Lambda (Node.js 18.x runtime)
zip -r function.zip .
aws lambda update-function-code --function-name iot-data-handler --zip-file fileb://function.zip
```

#### Lambda Environment Variables

**`iot-data-handler` and `iot-alert-handler`:**
```
PUSHER_APP_ID=your-pusher-app-id
PUSHER_KEY=your-pusher-key
PUSHER_SECRET=your-pusher-secret
PUSHER_CLUSTER=your-pusher-cluster
HISTORY_TABLE=GreenhouseSensorData    # iot-data-handler only
ALERTS_TABLE=GreenhouseAlerts         # iot-alert-handler only
```

**`api-handler`:**
```
AWS_IOT_ENDPOINT=your-endpoint.iot.region.amazonaws.com
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
```

The `api-handler` uses the Lambda execution role for DynamoDB and IoT Data Plane access — no hardcoded AWS credentials needed. Attach an IAM policy to the role granting:
- `dynamodb:Query`, `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:DeleteItem` on the three tables
- `iot:Publish` on `arn:aws:iot:*:*:topic/greenhouse/*/commands`

#### API Gateway
Create an **HTTP API** in API Gateway and configure a default route (`$default`) pointing to the `api-handler` Lambda. Note the invoke URL — this is your `VITE_API_URL`.

### 4. Frontend Setup

```bash
cd webapp/frontend

# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env
```

Edit `.env`:
```env
# API Gateway HTTP API URL
VITE_API_URL=https://YOUR_API_GATEWAY_ID.execute-api.YOUR_REGION.amazonaws.com

# AWS Cognito
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_COGNITO_DOMAIN=your-domain.auth.us-east-1.amazoncognito.com

# Pusher Channels
VITE_PUSHER_KEY=your-pusher-app-key
VITE_PUSHER_CLUSTER=ap1
```

#### Local Development
```bash
npm run dev
# Navigate to https://localhost:5173
```

#### Deploy to Vercel
```bash
npm install -g vercel
vercel deploy --prod
```

Set the same environment variables (`VITE_API_URL`, `VITE_COGNITO_*`, `VITE_PUSHER_*`) in the Vercel project settings under **Project → Settings → Environment Variables**.

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

These can be updated via the web dashboard or by sending an MQTT command to `greenhouse/{deviceId}/commands`.

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
5. Update `secrets.h` with endpoint and certificates

## 🚀 Usage

### Web Dashboard

1. Deploy the frontend to Vercel (or run locally with `npm run dev`)
2. Navigate to your Vercel deployment URL (or `https://localhost:5173` locally)
3. Sign in with AWS Cognito credentials
4. Add your device using its `deviceId`
5. View real-time sensor data pushed via Pusher and control devices via the dashboard

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
- `greenhouse/{deviceId}/commands` — Control and configuration commands

**Publish (Device sends data):**
- `greenhouse/{deviceId}/data` — Sensor data (triggers `iot-data-handler` Lambda)
- `greenhouse/{deviceId}/alerts` — Alert messages (triggers `iot-alert-handler` Lambda)

## 📚 API Documentation

All REST endpoints are served by the `api-handler` Lambda via **API Gateway HTTP API**. Every request (except OPTIONS) must include a valid Cognito ID token in the `Authorization` header.

### Devices

#### List Devices
```
GET /devices
Authorization: <Cognito ID token>
Response: [{ userId, deviceId, name, createdAt }, ...]
```

#### Add Device
```
POST /devices
Authorization: <Cognito ID token>
Body: { "deviceId": "my-device", "name": "My Greenhouse" }
Response: { "success": true, "device": { ... } }
```

#### Update Device Name
```
PUT /devices/{deviceId}
Authorization: <Cognito ID token>
Body: { "name": "New Name" }
Response: { "success": true }
```

#### Delete Device
```
DELETE /devices/{deviceId}
Authorization: <Cognito ID token>
Response: { "success": true }
```

#### Get Latest Device Status
```
GET /devices/{deviceId}/status
Authorization: <Cognito ID token>
Response: { deviceId, timestamp, temp, hum, soil, co2, tank_level, pump, fan, heater, mode, version }
```

### History & Alerts

#### Get Sensor History
```
GET /history/{deviceId}?start={unixTimestamp}&end={unixTimestamp}
Authorization: <Cognito ID token>
Response: [{ deviceId, timestamp, temp, hum, soil, co2, tank_level, ... }, ...]
```
Defaults to the last 24 hours if `start`/`end` are omitted.

#### Get Recent Alerts
```
GET /alerts/{deviceId}
Authorization: <Cognito ID token>
Response: [{ deviceId, timestamp, alert, message }, ...]   (latest 20)
```

### Commands

#### Send Command / Update Config
```
POST /command
Authorization: <Cognito ID token>
Body: {
  "deviceId": "my-device",
  "pump": true | false,       // optional
  "fan": true | false,        // optional
  "heater": true | false,     // optional
  "mode": "auto" | "manual",  // optional
  "temp_min": 18,             // optional, 0–100
  "temp_max": 32,             // optional, 0–100
  "hum_max": 80,              // optional, 0–100
  "soil_dry": 35,             // optional, 0–100
  "soil_wet": 65,             // optional, 0–100
  "tank_empty_dist": 25,      // optional, 1–999
  "tank_full_dist": 5         // optional, 1–999
}
Response: { "success": true }
```
Publishes the command as an MQTT message to `greenhouse/{deviceId}/commands` via IoT Core.

### Pusher Events (Real-time)

The frontend subscribes to the `greenhouse-{deviceId}` Pusher channel and listens for:

| Event | Payload | Source Lambda |
|---|---|---|
| `sensor-data` | Full sensor reading object | `iot-data-handler` |
| `device-status` | `{ online: true }` | `iot-data-handler` |
| `device-alert` | `{ alert, message, ... }` | `iot-alert-handler` |

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
- Uses AWS IoT Core, Lambda, API Gateway, DynamoDB, and Cognito
- [Pusher Channels](https://pusher.com) for serverless real-time push
- [Vercel](https://vercel.com) for frontend hosting
- React and Vite for modern web interface
- Various open-source libraries and sensors

## 📞 Support

For issues, questions, or contributions, please open an issue on GitHub.

---

**Made with ❤️ for sustainable agriculture and IoT innovation**
