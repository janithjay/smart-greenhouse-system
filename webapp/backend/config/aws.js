const AWS = require('aws-sdk');
const path = require('path');
// Load .env from parent directory (webapp/backend/.env)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Debug: Check if Env Vars are loaded
if (!process.env.AWS_REGION || !process.env.AWS_ACCESS_KEY_ID) {
    console.error("❌ CRITICAL ERROR: AWS Environment Variables are missing!");
    console.error("Current Directory:", process.cwd());
    console.error("AWS_REGION:", process.env.AWS_REGION);
} else {
    console.log(`✅ AWS Config Loaded. Region: ${process.env.AWS_REGION}, Table: GreenhouseUserDevices`);
}

AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const docClient = new AWS.DynamoDB.DocumentClient();

module.exports = {
    AWS,
    docClient,
    TABLE_NAME: "GreenhouseUserDevices",
    HISTORY_TABLE: "GreenhouseSensorData",
    ALERTS_TABLE: "GreenhouseAlerts"
};