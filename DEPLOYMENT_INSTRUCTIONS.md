# Free Tier Deployment Guide

## 1. Database (MongoDB Atlas)
1.  Create a free account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2.  Create a Free Cluster (M0 Sandbox).
3.  In "Network Access", add IP `0.0.0.0/0` (Allow all) to let Vercel connect.
4.  In "Database Access", create a user (e.g., `admin` / `password123`).
5.  Get the **Connection String** (Drivers -> Node.js).
    *   Format: `mongodb+srv://admin:password123@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

## 2. MQTT Broker (HiveMQ Cloud)
1.  Create a free account at [HiveMQ Cloud](https://www.hivemq.com/mqtt-cloud-broker/).
2.  Create a Serverless Cluster.
3.  Go to "Access Management" and create a user (e.g., `esp32_user` / `password123`).
4.  Note down the **Cluster URL** (e.g., `xxxxxx.s1.eu.hivemq.cloud`) and **Port** (8883 for SSL, 8884 for WSS).

## 3. Backend Deployment (Vercel)
1.  Push this code to your GitHub repository.
2.  Go to [Vercel Dashboard](https://vercel.com/) and click "Add New Project".
3.  Import your repository.
4.  **Root Directory**: Select `webapp/backend`.
5.  **Environment Variables**:
    *   `MONGODB_URI`: Paste your MongoDB Connection String.
6.  Click **Deploy**.
7.  Copy the resulting URL (e.g., `https://your-backend-project.vercel.app`).
    *   This is your `API_URL` (or `BACKEND_URL`).

## 4. Frontend Deployment (Vercel)
1.  Go to Vercel Dashboard and click "Add New Project".
2.  Import the **SAME** repository again.
3.  **Root Directory**: Select `webapp/frontend`.
4.  **Framework**: Select `Vite`.
5.  **Environment Variables**:
    *   `VITE_BACKEND_URL`: Paste the Backend URL from Step 3.
6.  Click **Deploy**.
7.  This is your Dashboard URL.

## 5. Firmware Configuration (ESP32)
1.  Open `src/secrets.h`.
2.  Update `MQTT_BROKER`, `MQTT_USER`, `MQTT_PASSWORD` with your HiveMQ details.
3.  Update `VERCEL_INGEST_URL` with your Backend URL + `/api/ingest`.
    *   Example: `https://your-backend-project.vercel.app/api/ingest`
4.  Upload to ESP32 using PlatformIO.

## 6. Frontend Configuration
1.  Open `webapp/frontend/src/App.jsx`.
2.  Update the `MQTT_BROKER` constant at the top with your HiveMQ **WSS** URL.
    *   Format: `wss://xxxxxx.s1.eu.hivemq.cloud:8884/mqtt` (Note logic: wss + port 8884 + /mqtt path).

## Done!
Your system is now 100% Serverless and Free.
- **Real-time Data**: ESP32 -> HiveMQ -> Frontend
- **Historical Data**: ESP32 -> Vercel API -> MongoDB -> Frontend (Graph)
