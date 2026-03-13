// Attached to AWS API Gateway HTTP API.
// Handles all REST routes + publishing MQTT commands to IoT Core.
//
// Routes (all require Cognito JWT in Authorization header):
//   GET    /devices
//   POST   /devices
//   PUT    /devices/{deviceId}
//   DELETE /devices/{deviceId}
//   GET    /devices/{deviceId}/status
//   GET    /alerts/{deviceId}
//   GET    /history/{deviceId}?start=&end=
//   POST   /command   { deviceId, ...command }

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand
} = require('@aws-sdk/lib-dynamodb');
const { IoTDataPlaneClient, PublishCommand } = require('@aws-sdk/client-iot-data-plane');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

// --- AWS Clients (use Lambda execution role — no hardcoded keys needed) ---
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const iotData = new IoTDataPlaneClient({
  endpoint: `https://${process.env.AWS_IOT_ENDPOINT}`
});

// --- Cognito Verifier (cached across warm invocations) ---
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse:   'id',
  clientId:   process.env.COGNITO_CLIENT_ID
});

// --- Table Names ---
const TABLE_NAME    = 'GreenhouseUserDevices';
const HISTORY_TABLE = 'GreenhouseSensorData';
const ALERTS_TABLE  = 'GreenhouseAlerts';

// --- Helpers ---
const res = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  },
  body: JSON.stringify(body)
});

const validateConfigValues = (command) => {
  const numericRanges = {
    temp_min:        [0, 100],
    temp_max:        [0, 100],
    hum_max:         [0, 100],
    soil_dry:        [0, 100],
    soil_wet:        [0, 100],
    tank_empty_dist: [1, 999],
    tank_full_dist:  [1, 999]
  };
  for (const [key, [min, max]] of Object.entries(numericRanges)) {
    if (command[key] !== undefined && (command[key] < min || command[key] > max)) {
      return `Invalid value for ${key}: must be ${min}-${max}`;
    }
  }
  return null;
};

// --- Main Handler ---
exports.handler = async (event) => {
  // CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return res(200, {});
  }

  const method = event.requestContext?.http?.method;
  const path   = event.rawPath;

  // Verify Cognito token
  let user;
  try {
    const token = event.headers?.authorization || event.headers?.Authorization;
    if (!token) throw new Error('No token');
    const payload = await verifier.verify(token);
    user = { id: payload.sub, email: payload.email };
  } catch {
    return res(401, { error: 'Unauthorized' });
  }

  try {
    // ── GET /devices ──────────────────────────────────────────────────────────
    if (method === 'GET' && path === '/devices') {
      const data = await dynamo.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': user.id }
      }));
      return res(200, data.Items);
    }

    // ── POST /devices ─────────────────────────────────────────────────────────
    if (method === 'POST' && path === '/devices') {
      const { deviceId, name } = JSON.parse(event.body || '{}');
      if (!deviceId) return res(400, { error: 'deviceId required' });
      const item = { userId: user.id, deviceId, name: name || deviceId, createdAt: Date.now() };
      await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return res(200, { success: true, device: item });
    }

    // ── PUT /devices/{deviceId} ────────────────────────────────────────────────
    const devicePathMatch = path.match(/^\/devices\/([^/]+)$/);
    if (method === 'PUT' && devicePathMatch) {
      const { name } = JSON.parse(event.body || '{}');
      await dynamo.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId: user.id, deviceId: devicePathMatch[1] },
        UpdateExpression: 'set #n = :n',
        ExpressionAttributeNames:  { '#n': 'name' },
        ExpressionAttributeValues: { ':n': name }
      }));
      return res(200, { success: true });
    }

    // ── DELETE /devices/{deviceId} ─────────────────────────────────────────────
    if (method === 'DELETE' && devicePathMatch) {
      await dynamo.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { userId: user.id, deviceId: devicePathMatch[1] }
      }));
      return res(200, { success: true });
    }

    // ── GET /devices/{deviceId}/status ─────────────────────────────────────────
    const statusMatch = path.match(/^\/devices\/([^/]+)\/status$/);
    if (method === 'GET' && statusMatch) {
      const data = await dynamo.send(new QueryCommand({
        TableName: HISTORY_TABLE,
        KeyConditionExpression: 'deviceId = :did',
        ExpressionAttributeValues: { ':did': statusMatch[1] },
        Limit: 1,
        ScanIndexForward: false
      }));
      return res(200, data.Items[0] || {});
    }

    // ── GET /alerts/{deviceId} ─────────────────────────────────────────────────
    const alertsMatch = path.match(/^\/alerts\/([^/]+)$/);
    if (method === 'GET' && alertsMatch) {
      const data = await dynamo.send(new QueryCommand({
        TableName: ALERTS_TABLE,
        KeyConditionExpression: 'deviceId = :did',
        ExpressionAttributeValues: { ':did': alertsMatch[1] },
        ScanIndexForward: false,
        Limit: 20
      }));
      return res(200, data.Items);
    }

    // ── GET /history/{deviceId} ────────────────────────────────────────────────
    const historyMatch = path.match(/^\/history\/([^/]+)$/);
    if (method === 'GET' && historyMatch) {
      const qp        = event.queryStringParameters || {};
      const startTime = qp.start ? parseInt(qp.start).toString() : (Math.floor(Date.now() / 1000) - 86400).toString();
      const endTime   = qp.end   ? parseInt(qp.end).toString()   : Math.floor(Date.now() / 1000).toString();
      const data = await dynamo.send(new QueryCommand({
        TableName: HISTORY_TABLE,
        KeyConditionExpression: 'deviceId = :did AND #ts BETWEEN :start AND :end',
        ExpressionAttributeNames:  { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':did': historyMatch[1], ':start': startTime, ':end': endTime },
        ScanIndexForward: true
      }));
      return res(200, data.Items);
    }

    // ── POST /command ──────────────────────────────────────────────────────────
    // Publishes MQTT command to the device via IoT Core
    if (method === 'POST' && path === '/command') {
      const body = JSON.parse(event.body || '{}');
      const { deviceId, ...command } = body;
      if (!deviceId) return res(400, { error: 'deviceId required' });

      const validationError = validateConfigValues(command);
      if (validationError) return res(400, { error: validationError });

      await iotData.send(new PublishCommand({
        topic:   `greenhouse/${deviceId}/commands`,
        payload: Buffer.from(JSON.stringify(command)),
        qos:     1
      }));
      return res(200, { success: true });
    }

    return res(404, { error: 'Not found' });

  } catch (err) {
    console.error('Handler error:', err);
    return res(500, { error: 'Internal server error' });
  }
};
