import React, { useState, useEffect } from 'react';
import { Thermometer, Droplets, Wind, Activity, Waves, Plus, Trash2, Edit } from 'lucide-react';
import io from 'socket.io-client';
import { Authenticator, useAuthenticator, View, Button, Heading } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { fetchAuthSession, signInWithRedirect } from 'aws-amplify/auth';
import SensorCard from './components/SensorCard';
import ControlPanel from './components/ControlPanel';
import ConfigPanel from './components/ConfigPanel';
import HistoryGraph from './components/HistoryGraph';
import AlertLog from './components/AlertLog';
import './App.css';
import './AuthStyles.css';
import { signOut as amplifySignOut } from 'aws-amplify/auth';


// Connect to Backend
// In Production (Amplify), we use Rewrites to proxy requests to EC2, so we connect to the same origin.
// In Development (Localhost), we connect directly to port 3001.
const isLocal = window.location.hostname === 'localhost' || window.location.hostname.match(/^192\.168\./) || window.location.hostname.match(/^127\./);
const BACKEND_URL = isLocal
  ? `https://${window.location.hostname}:3001`
  : window.location.origin;

const socket = io(BACKEND_URL, {
  rejectUnauthorized: false, // Allow self-signed certs in dev
  path: '/socket.io' // Standard Socket.io path
});

function Dashboard({ user, signOut }) {
  // --- State ---
  const [deviceId, setDeviceId] = useState('');
  const [userDevices, setUserDevices] = useState([]);
  const [view, setView] = useState('list'); // 'list' or 'dashboard'

  const [sensorData, setSensorData] = useState({
    temp: 0, hum: 0, soil: 0, co2: 0, tank_level: 0, timestamp: Date.now(), version: 'Unknown'
  });

  const [devices, setDevices] = useState({ pump: false, fan: false, heater: false });
  const [mode, setMode] = useState('AUTO');
  const [connected, setConnected] = useState(false);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [config, setConfig] = useState({
    temp_min: 20.0, temp_max: 30.0, hum_max: 75.0, soil_dry: 40, soil_wet: 70,
    tank_empty_dist: 25, tank_full_dist: 5
  });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState({ pump: false, fan: false, heater: false, mode: false });
  const [showAlerts, setShowAlerts] = useState(false);
  const [alerts, setAlerts] = useState([]);

  // --- Fetch Devices on Load ---
  useEffect(() => {
    fetchDevices();
  }, []);

  // --- Session Timeout Check (24 Hours) ---
  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await fetchAuthSession();
        if (!session.tokens?.idToken?.payload?.auth_time) return;

        const authTime = session.tokens.idToken.payload.auth_time;
        const now = Math.floor(Date.now() / 1000);
        const elapsed = now - authTime;
        const limit = 24 * 60 * 60; // 24 hours in seconds

        if (elapsed >= limit) {
          console.log("Session expired (24h limit). Signing out.");
          await signOut();
          window.location.reload();
        }
      } catch (err) {
        console.error("Session check failed", err);
      }
    };

    // Check immediately and every minute
    checkSession();
    const interval = setInterval(checkSession, 60000);
    return () => clearInterval(interval);
  }, [signOut]);

  const fetchDevices = async () => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken.toString();
      const url = isLocal
        ? `https://${window.location.hostname}:3001/api/devices`
        : `${window.location.origin}/api/devices`;

      const res = await fetch(url, {
        headers: { Authorization: token }
      });
      const data = await res.json();
      setUserDevices(data);
    } catch (err) {
      console.error("Failed to fetch devices", err);
    }
  };

  const addDevice = async (e) => {
    e.preventDefault();
    const id = e.target.elements.newDeviceId.value.trim();
    const name = e.target.elements.newDeviceName.value.trim();
    if (!id) return;

    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken.toString();
      const url = isLocal
        ? `https://${window.location.hostname}:3001/api/devices`
        : `${window.location.origin}/api/devices`;

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({ deviceId: id, name })
      });
      fetchDevices();
      e.target.reset();
    } catch (err) {
      alert("Failed to add device");
    }
  };

  const removeDevice = async (id) => {
    if (!confirm("Are you sure?")) return;
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken.toString();
      const url = isLocal
        ? `https://${window.location.hostname}:3001/api/devices/${id}`
        : `${window.location.origin}/api/devices/${id}`;

      await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: token }
      });
      fetchDevices();
      if (deviceId === id) {
        setDeviceId('');
        setView('list');
      }
    } catch (err) {
      alert("Failed to remove device");
    }
  };

  const updateDeviceName = async (id, currentName) => {
    const newName = prompt("Enter new name for device:", currentName);
    if (!newName || newName === currentName) return;

    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken.toString();
      const url = isLocal
        ? `https://${window.location.hostname}:3001/api/devices/${id}`
        : `${window.location.origin}/api/devices/${id}`;

      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({ name: newName })
      });
      fetchDevices();
    } catch (err) {
      alert("Failed to update device name");
    }
  };

  const selectDevice = (id) => {
    setDeviceId(id);
    setView('dashboard');
    socket.emit('join-device', id);
  };

  // Fetch latest status when device is selected
  useEffect(() => {
    if (deviceId) {
      fetchDeviceStatus(deviceId);
      fetchHistory(deviceId); // Also fetch history for graph
      fetchAlerts(deviceId);
    }
  }, [deviceId]);

  const fetchDeviceStatus = async (id) => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken.toString();
      const url = isLocal
        ? `https://${window.location.hostname}:3001/api/devices/${id}/status`
        : `${window.location.origin}/api/devices/${id}/status`;

      const res = await fetch(url, {
        headers: { Authorization: token }
      });
      const data = await res.json();
      
      if (data && data.timestamp) {
         setSensorData(prev => ({ 
             ...prev, 
             ...data, 
             timestamp: data.timestamp * 1000, // Convert to ms
             version: data.version || 'Unknown' // Set Version
         }));
         
         setDevices({
             pump: data.pump === 1,
             fan: data.fan === 1,
             heater: data.heater === 1
         });
         if (data.mode) setMode(data.mode);
      }
    } catch (err) {
      console.error("Failed to fetch device status", err);
    }
  };

  const fetchHistory = async (id, date = null) => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken.toString();
      let url = isLocal
        ? `https://${window.location.hostname}:3001/api/history/${id}`
        : `${window.location.origin}/api/history/${id}`;

      if (date) {
          const start = Math.floor(new Date(date).setHours(0,0,0,0) / 1000);
          const end = Math.floor(new Date(date).setHours(23,59,59,999) / 1000);
          url += `?start=${start}&end=${end}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: token }
      });
      const data = await res.json();
      
      // Format for graph
      const formatted = data.map(d => ({
        time: new Date(d.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        temp: d.temp,
        hum: d.hum,
        soil: d.soil,
        pump: d.pump ? 1 : 0,
        fan: d.fan ? 1 : 0,
        heater: d.heater ? 1 : 0,
        mode: d.mode
      }));
      setHistory(formatted);

      // Load latest historical data into current view (for offline devices)
      // Only if we are viewing TODAY's data or default view
      const isToday = !date || date === new Date().toISOString().split('T')[0];
      if (isToday && data.length > 0) {
        const latest = data[data.length - 1];
        setSensorData(prev => ({
          ...prev,
          temp: latest.temp, 
          hum: latest.hum, 
          soil: latest.soil, 
          co2: latest.co2, 
          tank_level: latest.tank_level, 
          timestamp: latest.timestamp * 1000,
          version: latest.version || prev.version // Preserve version if not in history
        }));
        setDevices({ 
          pump: latest.pump === 1, 
          fan: latest.fan === 1, 
          heater: latest.heater === 1 
        });
        if (latest.mode) setMode(latest.mode);
      }

    } catch (err) {
      console.error("Failed to fetch history", err);
    }
  };

  const fetchAlerts = async (id) => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken.toString();
      const url = isLocal
        ? `https://${window.location.hostname}:3001/api/alerts/${id}`
        : `${window.location.origin}/api/alerts/${id}`;

      const res = await fetch(url, {
        headers: { Authorization: token }
      });
      const data = await res.json();
      setAlerts(data);
    } catch (err) {
      console.error("Failed to fetch alerts", err);
    }
  };

  // --- Socket.io Effect ---
  useEffect(() => {
    if (deviceId) {
      socket.emit('join-device', deviceId);
      fetchHistory(deviceId);
      fetchAlerts(deviceId);
    }

    socket.on('connect', () => {
      setConnected(true);
      if (deviceId) socket.emit('join-device', deviceId);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setDeviceOnline(false);
    });

    socket.on('device-status', (status) => setDeviceOnline(status.online));
    socket.on('config-error', (err) => alert(err.message));
    
    // Handle Critical Alerts (e.g., Rollback)
    socket.on('device-alert', (alertData) => {
        if (alertData.alert === 'ROLLBACK_EXECUTED') {
            alert(`⚠️ CRITICAL ALERT: ${alertData.message}`);
        }
        // Refresh alerts list
        fetchAlerts(deviceId);
    });

    socket.on('sensor-data', (data) => {
      setSensorData(data);
      setDevices({ pump: data.pump === 1, fan: data.fan === 1, heater: data.heater === 1 });
      if (data.mode) setMode(data.mode);
      setLoading({ pump: false, fan: false, heater: false, mode: false });
      setHistory(prev => {
        const newHist = [...prev, {
          time: new Date(data.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          temp: data.temp, hum: data.hum, soil: data.soil,
          pump: data.pump ? 1 : 0, fan: data.fan ? 1 : 0, heater: data.heater ? 1 : 0, mode: data.mode
        }];
        if (newHist.length > 50) newHist.shift(); // Increased history size
        return newHist;
      });
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('device-status');
      socket.off('config-error');
      socket.off('device-alert');
      socket.off('sensor-data');
    };
  }, [deviceId]);

  // --- Handlers ---
  const handleDeviceToggle = (device) => {
    if (mode === 'AUTO') return;
    setLoading(prev => ({ ...prev, [device]: true }));
    socket.emit('control-command', { [device]: !devices[device] ? 1 : 0 });
  };

  const handleModeToggle = (newMode) => {
    setLoading(prev => ({ ...prev, mode: true }));
    socket.emit('control-command', { mode: newMode });
  };

  const handleConfigSave = (newConfig) => {
    setConfig(newConfig);
    socket.emit('config-update', newConfig);
    alert("Configuration Sent to Device");
  };

  const handleFirmwareUpdate = (url) => {
    if (!url) return;
    if (!confirm(`WARNING: This will update the device firmware from:\n${url}\n\nDo you want to proceed?`)) return;
    
    socket.emit('control-command', { update_url: url });
    alert("Update Command Sent! The device will reboot if the update is successful.");
  };

  if (view === 'list') {
    return (
      <div className="app-container">
        <header className="app-header">
          <h1>My Greenhouses</h1>
          <button onClick={signOut} className="logout-btn">Sign Out</button>
        </header>

        <div className="device-list-container">
          <div className="add-device-card">
            <h3>Add New Device</h3>
            <form onSubmit={addDevice}>
              <input name="newDeviceId" placeholder="Device ID (e.g. GH-XXXX)" required />
              <input name="newDeviceName" placeholder="Friendly Name (e.g. Orchid House)" />
              <button type="submit"><Plus size={16} /> Add Device</button>
            </form>
          </div>

          <div className="device-grid">
            {userDevices.map(dev => (
              <div key={dev.deviceId} className="device-card" onClick={() => selectDevice(dev.deviceId)}>
                <h3>{dev.name}</h3>
                <p>ID: {dev.deviceId}</p>
                <div className="card-actions">
                  <button className="icon-btn edit-btn" onClick={(e) => { e.stopPropagation(); updateDeviceName(dev.deviceId, dev.name); }}>
                    <Edit size={16} />
                  </button>
                  <button className="icon-btn delete-btn" onClick={(e) => { e.stopPropagation(); removeDevice(dev.deviceId); }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <button onClick={() => setView('list')} className="back-btn">← Back</button>
          <h1>{userDevices.find(d => d.deviceId === deviceId)?.name || deviceId} <span className="device-badge">{deviceId}</span></h1>
        </div>
        <div className="status-group">
          <div className={`connection-status ${connected ? 'online' : 'offline'}`}>
            <div className="dot"></div> Server: {connected ? 'Connected' : 'Disconnected'}
          </div>
          <div className={`connection-status ${deviceOnline ? 'online' : 'offline'}`}>
            <div className="dot"></div> Device: {deviceOnline ? 'Online' : 'Offline'}
          </div>
        </div>
      </header>

      <main className="dashboard-grid">
        {/* Row 1: Sensors */}
        <section className="sensors-section">
          <SensorCard title="Temperature" value={sensorData.temp} unit="°C" icon={Thermometer} color="#ff7300" />
          <SensorCard title="Humidity" value={sensorData.hum} unit="%" icon={Droplets} color="#387908" />
          <SensorCard title="Soil Moisture" value={sensorData.soil} unit="%" icon={Waves} color="#0088fe" />
          <SensorCard title="CO2 Level" value={sensorData.co2} unit="ppm" icon={Wind} color="#8884d8" />
          <SensorCard title="Tank Level" value={sensorData.tank_level} unit="%" icon={Activity} color="#00C49F" />
        </section>

        {/* Row 2: Controls & Config */}
        <section className="controls-section">
          <ControlPanel mode={mode} setMode={handleModeToggle} devices={devices} toggleDevice={handleDeviceToggle} loading={loading} />
          <ConfigPanel 
            config={config} 
            onSave={handleConfigSave} 
            onUpdateFirmware={handleFirmwareUpdate} 
            currentVersion={sensorData.version}
            onViewLogs={() => setShowAlerts(true)}
          />
        </section>

        {/* Row 3: Graphs */}
        <section className="graph-section">
          <HistoryGraph data={history} onDateChange={(date) => fetchHistory(deviceId, date)} />
        </section>
      </main>

      {showAlerts && <AlertLog alerts={alerts} onClose={() => setShowAlerts(false)} />}
    </div>
  );
}

function App() {
  return (
    <div className="auth-wrapper">
      <Authenticator>
        {({ signOut, user }) => (
          <Dashboard
            user={user}
            signOut={async () => {
              const domain = import.meta.env.VITE_COGNITO_DOMAIN;
              const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
              const logoutUri = window.location.origin + '/';

              // 1️⃣ Fully clear Cognito + federated IdP state
              try {
                await amplifySignOut({ global: true });
              } catch (error) {
                console.warn("Amplify signOut failed (ignoring):", error);
              }

              // 2️⃣ Hard redirect through Hosted UI logout
              window.location.href =
                `https://${domain}/logout` +
                `?client_id=${clientId}` +
                `&logout_uri=${encodeURIComponent(logoutUri)}`;
            }}
          />
        )}
      </Authenticator>
    </div>
  );
}

export default App;
