const AWS = require('aws-sdk');
require('dotenv').config();

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