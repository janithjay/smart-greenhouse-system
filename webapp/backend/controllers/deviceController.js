const { docClient, TABLE_NAME, HISTORY_TABLE, ALERTS_TABLE } = require('../config/aws');

// 1. Get User's Devices
exports.getDevices = async (req, res) => {
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: { ":uid": req.user.id }
  };

  try {
    const data = await docClient.query(params).promise();
    res.json(data.Items);
  } catch (err) {
    console.error("DynamoDB Error:", err);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
};

// 2. Add Device
exports.addDevice = async (req, res) => {
  const { deviceId, name } = req.body;
  if (!deviceId) return res.status(400).json({ error: "Device ID required" });

  const params = {
    TableName: TABLE_NAME,
    Item: {
      userId: req.user.id,
      deviceId: deviceId,
      name: name || deviceId,
      createdAt: Date.now()
    }
  };

  try {
    await docClient.put(params).promise();
    res.json({ success: true, device: params.Item });
  } catch (err) {
    console.error("DynamoDB Error:", err);
    res.status(500).json({ error: "Failed to add device" });
  }
};

// 3. Update Device Name
exports.updateDeviceName = async (req, res) => {
  const { deviceId } = req.params;
  const { name } = req.body;

  const params = {
    TableName: TABLE_NAME,
    Key: {
      userId: req.user.id,
      deviceId: deviceId
    },
    UpdateExpression: "set #n = :n",
    ExpressionAttributeNames: { "#n": "name" },
    ExpressionAttributeValues: { ":n": name },
    ReturnValues: "UPDATED_NEW"
  };

  try {
    await docClient.update(params).promise();
    res.json({ success: true });
  } catch (err) {
    console.error("DynamoDB Error:", err);
    res.status(500).json({ error: "Failed to update device" });
  }
};

// 4. Remove Device
exports.removeDevice = async (req, res) => {
  const params = {
    TableName: TABLE_NAME,
    Key: {
      userId: req.user.id,
      deviceId: req.params.deviceId
    }
  };

  try {
    await docClient.delete(params).promise();
    res.json({ success: true });
  } catch (err) {
    console.error("DynamoDB Error:", err);
    res.status(500).json({ error: "Failed to delete device" });
  }
};

// 5. Get Device Last Status (for Offline View)
exports.getDeviceStatus = async (req, res) => {
  const { deviceId } = req.params;
  
  const params = {
    TableName: HISTORY_TABLE,
    KeyConditionExpression: "deviceId = :did",
    ExpressionAttributeValues: { ":did": deviceId },
    Limit: 1,
    ScanIndexForward: false // Get latest
  };

  try {
    const data = await docClient.query(params).promise();
    if (data.Items.length > 0) {
      res.json(data.Items[0]);
    } else {
      res.json({});
    }
  } catch (err) {
    console.error("DynamoDB Error:", err);
    res.status(500).json({ error: "Failed to fetch status" });
  }
};

// 6. Get Device Alerts
exports.getDeviceAlerts = async (req, res) => {
  const { deviceId } = req.params;
  
  // Verify user owns this device (Basic check)
  // In production, you should query GreenhouseUserDevices to ensure ownership
  
  const params = {
    TableName: ALERTS_TABLE,
    KeyConditionExpression: "deviceId = :did",
    ExpressionAttributeValues: { ":did": deviceId },
    ScanIndexForward: false, // Newest first
    Limit: 20 // Last 20 alerts
  };

  try {
    const data = await docClient.query(params).promise();
    res.json(data.Items);
  } catch (err) {
    console.error("DynamoDB Error:", err);
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
};

// 7. Get Device History
exports.getDeviceHistory = async (req, res) => {
  const { deviceId } = req.params;
  const { start, end } = req.query;

  // Default: Last 24 hours if no range provided
  let startTime = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
  let endTime = Math.floor(Date.now() / 1000);

  if (start) startTime = parseInt(start);
  if (end) endTime = parseInt(end);

  const params = {
    TableName: HISTORY_TABLE,
    KeyConditionExpression: "deviceId = :did AND #ts BETWEEN :start AND :end",
    ExpressionAttributeNames: { "#ts": "timestamp" },
    ExpressionAttributeValues: {
      ":did": deviceId,
      ":start": startTime,
      ":end": endTime
    },
    ScanIndexForward: true // Return oldest to newest (for graph)
  };

  try {
    const data = await docClient.query(params).promise();
    res.json(data.Items);
  } catch (err) {
    console.error("DynamoDB History Error:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
};