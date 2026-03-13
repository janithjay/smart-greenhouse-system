// Triggered by AWS IoT Rule:
//   Topic:  greenhouse/+/data
//   SQL:    SELECT *, topic() AS topicName FROM 'greenhouse/+/data'
//
// What it does:
//   1. Saves incoming sensor data to DynamoDB (GreenhouseSensorData)
//   2. Pushes live update to frontend via Pusher channel

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

const HISTORY_TABLE = process.env.HISTORY_TABLE || 'GreenhouseSensorData';

exports.handler = async (event) => {
  const { topicName, ...data } = event;

  if (!topicName) {
    console.error('Missing topicName — IoT Rule SQL must include topic() AS topicName');
    return;
  }

  const topicParts = topicName.split('/');
  const deviceId = topicParts[1];
  const timestamp = data.timestamp || Math.floor(Date.now() / 1000);

  // Save to DynamoDB
  await dynamo.send(new PutCommand({
    TableName: HISTORY_TABLE,
    Item: {
      deviceId,
      timestamp,
      temp:       data.temp,
      hum:        data.hum,
      soil:       data.soil,
      co2:        data.co2,
      tank_level: data.tank_level,
      pump:       data.pump,
      fan:        data.fan,
      heater:     data.heater,
      mode:       data.mode,
      version:    data.version
    }
  }));

  // Push real-time updates to the frontend via Pusher
  await Promise.all([
    pusher.trigger(`greenhouse-${deviceId}`, 'sensor-data',   data),
    pusher.trigger(`greenhouse-${deviceId}`, 'device-status', { online: true })
  ]);
};
