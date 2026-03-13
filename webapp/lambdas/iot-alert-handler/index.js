// Triggered by AWS IoT Rule:
//   Topic:  greenhouse/+/alerts
//   SQL:    SELECT *, topic() AS topicName FROM 'greenhouse/+/alerts'
//
// What it does:
//   1. Saves alert to DynamoDB (GreenhouseAlerts)
//   2. Pushes alert to frontend via Pusher

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const Pusher = require('pusher');

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const pusher = new Pusher({
  appId:   process.env.PUSHER_APP_ID,
  key:     process.env.PUSHER_KEY,
  secret:  process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS:  true
});

const ALERTS_TABLE = process.env.ALERTS_TABLE || 'GreenhouseAlerts';

exports.handler = async (event) => {
  const { topicName, ...alertData } = event;

  if (!topicName) {
    console.error('Missing topicName — IoT Rule SQL must include topic() AS topicName');
    return;
  }

  const topicParts = topicName.split('/');
  const deviceId = topicParts[1];
  const timestamp = alertData.timestamp ? alertData.timestamp.toString() : Math.floor(Date.now() / 1000).toString();

  console.log(`Alert from ${deviceId}:`, alertData);

  // Save to DynamoDB
  await dynamo.send(new PutCommand({
    TableName: ALERTS_TABLE,
    Item: {
      deviceId,
      timestamp,
      alert:   alertData.alert,
      message: alertData.message
    }
  }));

  // Push to frontend
  await pusher.trigger(`greenhouse-${deviceId}`, 'device-alert', alertData);
};
