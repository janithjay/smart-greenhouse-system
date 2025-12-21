const awsIot = require('aws-iot-device-sdk');
const path = require('path');
const fs = require('fs');
const { docClient, HISTORY_TABLE, ALERTS_TABLE } = require('../config/aws');

const DEVICE_NAME = 'GreenHouse_Hub';
const AWS_IOT_ENDPOINT = process.env.AWS_IOT_ENDPOINT;

let device;

const initIoT = (io) => {
    // Check if certs exist
    const certsDir = path.join(__dirname, '..', 'certs');
    const certsExist = fs.existsSync(path.join(certsDir, 'private.pem.key')) &&
                       fs.existsSync(path.join(certsDir, 'certificate.pem.crt')) &&
                       fs.existsSync(path.join(certsDir, 'AmazonRootCA1.pem'));

    if (certsExist && AWS_IOT_ENDPOINT) {
        device = awsIot.device({
            keyPath: path.join(certsDir, 'private.pem.key'),
            certPath: path.join(certsDir, 'certificate.pem.crt'),
            caPath: path.join(certsDir, 'AmazonRootCA1.pem'),
            clientId: DEVICE_NAME,
            host: AWS_IOT_ENDPOINT
        });

        // --- AWS IoT Events ---
        device.on('connect', () => {
            console.log('✅ Connected to AWS IoT Core');
            device.subscribe('greenhouse/+/data');
            device.subscribe('greenhouse/+/alerts');
            console.log('✅ Subscribed to greenhouse/+/data & alerts');
        });

        device.on('message', (topic, payload) => {
            const message = payload.toString();
            const topicParts = topic.split('/');
            
            // 1. Handle Sensor Data
            if (topicParts.length === 3 && topicParts[2] === 'data') {
                const deviceId = topicParts[1];
                try {
                    const data = JSON.parse(message);
                    
                    // Broadcast to clients
                    io.to(deviceId).emit('sensor-data', data);
                    io.to(deviceId).emit('device-status', { online: true });
                    
                    // Save to DynamoDB
                    const dbParams = {
                        TableName: HISTORY_TABLE,
                        Item: {
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
                        }
                    };
                    
                    docClient.put(dbParams).promise().catch(err => {
                        console.error("Failed to save history:", err);
                    });

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
                    
                    const dbParams = {
                        TableName: ALERTS_TABLE,
                        Item: {
                            deviceId: deviceId,
                            timestamp: alertData.timestamp || Math.floor(Date.now() / 1000),
                            alert: alertData.alert,
                            message: alertData.message
                        }
                    };
                    
                    docClient.put(dbParams).promise().catch(err => {
                        console.error("Failed to save alert:", err);
                    });
                    
                } catch (e) {
                    console.error('Error parsing Alert JSON:', e);
                }
            }
        });

        device.on('error', (error) => {
            console.error('❌ AWS IoT Error:', error);
        });
    } else {
        console.log('⚠️ AWS IoT Certificates or Endpoint missing. Running in Simulation Mode.');
    }
};

const publishCommand = (deviceId, command) => {
    if (device) {
        const topic = `greenhouse/${deviceId}/commands`;
        device.publish(topic, JSON.stringify(command));
    }
};

module.exports = { initIoT, publishCommand };