const express = require('express');
const router = express.Router();
const verifyAuth = require('../middleware/auth');
const deviceController = require('../controllers/deviceController');

// Device Routes
router.get('/devices', verifyAuth, deviceController.getDevices);
router.post('/devices', verifyAuth, deviceController.addDevice);
router.put('/devices/:deviceId', verifyAuth, deviceController.updateDeviceName);
router.delete('/devices/:deviceId', verifyAuth, deviceController.removeDevice);

// Data Routes
router.get('/devices/:deviceId/status', verifyAuth, deviceController.getDeviceStatus);
router.get('/alerts/:deviceId', verifyAuth, deviceController.getDeviceAlerts);
router.get('/history/:deviceId', verifyAuth, deviceController.getDeviceHistory);

module.exports = router;