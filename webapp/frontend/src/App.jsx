import React, { useState, useEffect, useRef } from 'react';
import { Thermometer, Droplets, Wind, Activity, Waves, Plus, Trash2, Edit } from 'lucide-react';
import Pusher from 'pusher-js';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { fetchAuthSession } from 'aws-amplify/auth';
import SensorCard from './components/SensorCard';
import ControlPanel from './components/ControlPanel';
import ConfigPanel from './components/ConfigPanel';
import HistoryGraph from './components/HistoryGraph';
import AlertLog from './components/AlertLog';
import './App.css';
import './AuthStyles.css';
import { signOut as amplifySignOut } from 'aws-amplify/auth';

// API Gateway URL (set VITE_API_URL in .env / Amplify env vars)
// For local development, point to the old server: https://localhost:3001
const API_URL      = import.meta.env.VITE_API_URL      || 'https://localhost:3001';
const PUSHER_KEY     = import.meta.env.VITE_PUSHER_KEY;
const PUSHER_CLUSTER = import.meta.env.VITE_PUSHER_CLUSTER || 'ap1';

async function getToken() {
  const session = await fetchAuthSession();
  return session.tokens.idToken.toString();
}

async function apiCall(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      ...(options.headers || {})
    }
  });
  return res.json();
}

function Dashboard({ user, signOut }) {
  // --- State ---
  const [deviceId, setDeviceId] = useState('');
  const [userDevices, setUserDevices] = useState([]);
  const [view, setView] = useState('list'); // 'list' or 'dashboard'

  const [sensorData, setSensorData] = useState({
    temp: 0, hum: 0, soil: 0, co2: 0, tank_level: 0, timestamp: Date.now(), version: 'Unknown'
  });

  const [devices, setDevices] = useState({ pump: false, fan: false, heater: false });
  const [mode, setMode] = useState('MANUAL');
  const [connected, setConnected] = useState(false);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [config, setConfig] = useState({
    temp_min: 20.0, temp_max: 30.0, hum_max: 75.0, soil_dry: 40, soil_wet: 70,
    tank_empty_dist: 25, tank_full_dist: 5,
    schedules: []
  });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState({ pump: false, fan: false, heater: false, mode: false });
  const [showAlerts, setShowAlerts] = useState(false);
  const [alerts, setAlerts] = useState([]);

  // --- Pusher refs ---
  const pusherRef   = useRef(null);
  const channelRef  = useRef(null);
  const lastDataRef = useRef(0); // epoch ms of last received Pusher event

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

  // --- Pusher: subscribe when device is selected ---
  useEffect(() => {
    if (!deviceId || !PUSHER_KEY) return;

    // Disconnect any previous connection
    if (pusherRef.current) {
      pusherRef.current.disconnect();
    }

    const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });
    pusherRef.current = pusher;

    pusher.connection.bind('connected',    () => setConnected(true));
    pusher.connection.bind('disconnected', () => { setConnected(false); setDeviceOnline(false); });

    const channel = pusher.subscribe(`greenhouse-${deviceId}`);
    channelRef.current = channel;

    channel.bind('sensor-data', (data) => {
      lastDataRef.current = Date.now();
      setSensorData(data);
      setDevices({ pump: data.pump === 1, fan: data.fan === 1, heater: data.heater === 1 });
      if (data.mode) setMode(data.mode);
      if (data.schedules) {
          setConfig(prev => ({ ...prev, schedules: data.schedules }));
      }
      setLoading({ pump: false, fan: false, heater: false, mode: false });
      setHistory(prev => {
        const newHist = [...prev, {
          time: new Date(data.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          temp: data.temp, hum: data.hum, co2: data.co2, soil: data.soil,
          pump: data.pump ? 1 : 0, fan: data.fan ? 1 : 0, heater: data.heater ? 1 : 0, mode: data.mode
        }];
        if (newHist.length > 50) newHist.shift();
        return newHist;
      });
    });

    channel.bind('device-status', (status) => {
      if (status.online) lastDataRef.current = Date.now();
      setDeviceOnline(status.online);
    });

    channel.bind('device-alert', (alertData) => {
      if (alertData.alert === 'ROLLBACK_EXECUTED') {
        alert(`⚠️ CRITICAL ALERT: ${alertData.message}`);
      }
      fetchAlerts(deviceId);
    });

    // Mark device offline if no Pusher data for 30 seconds
    const offlineTimer = setInterval(() => {
      if (lastDataRef.current > 0 && Date.now() - lastDataRef.current > 30000) {
        setDeviceOnline(false);
      }
    }, 5000);

    return () => {
      clearInterval(offlineTimer);
      channel.unbind_all();
      pusher.unsubscribe(`greenhouse-${deviceId}`);
      pusher.disconnect();
    };
  }, [deviceId]);

  const fetchDevices = async () => {
    try {
      const data = await apiCall('/devices');
      setUserDevices(Array.isArray(data) ? data : []);
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
      await apiCall('/devices', {
        method: 'POST',
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
      await apiCall(`/devices/${id}`, { method: 'DELETE' });
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
      await apiCall(`/devices/${id}`, {
        method: 'PUT',
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
    setDeviceOnline(false);
    lastDataRef.current = 0;
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
      const data = await apiCall(`/devices/${id}/status`);
      if (data && data.timestamp) {
         setSensorData(prev => ({ 
             ...prev, 
             ...data, 
             timestamp: data.timestamp * 1000,
             version: data.version || 'Unknown'
         }));
         setDevices({
             pump: data.pump === 1,
             fan: data.fan === 1,
             heater: data.heater === 1
         });
         if (data.mode) setMode(data.mode);
         if (data.schedules) {
             setConfig(prev => ({ ...prev, schedules: data.schedules }));
         }
      }
    } catch (err) {
      console.error("Failed to fetch device status", err);
    }
  };

  const fetchHistory = async (id, date = null) => {
    try {
      let url = `/history/${id}`;
      if (date) {
          const start = Math.floor(new Date(date).setHours(0,0,0,0) / 1000);
          const end = Math.floor(new Date(date).setHours(23,59,59,999) / 1000);
          url += `?start=${start}&end=${end}`;
      }
      const data = await apiCall(url);
      
      // Format for graph
      const formatted = data.map(d => ({
        time: new Date(parseInt(d.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        temp: d.temp,
        hum: d.hum,
        co2: d.co2,
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
      const data = await apiCall(`/alerts/${id}`);
      setAlerts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch alerts", err);
    }
  };

  // --- Send command/config to device via API Gateway → Lambda → IoT Core ---
  const sendCommand = async (command) => {
    try {
      const result = await apiCall('/command', {
        method: 'POST',
        body: JSON.stringify({ deviceId, ...command })
      });
      if (result.error) {
        alert(`Command error: ${result.error}`);
        setLoading({ pump: false, fan: false, heater: false, mode: false });
      }
    } catch (err) {
      alert("Failed to send command");
      setLoading({ pump: false, fan: false, heater: false, mode: false });
    }
  };

  // --- Handlers ---
  const handleDeviceToggle = (device) => {
    if (mode === 'AUTO') return;
    setLoading(prev => ({ ...prev, [device]: true }));
    sendCommand({ [device]: !devices[device] ? 1 : 0 });
  };

  const handleModeToggle = (newMode) => {
    setLoading(prev => ({ ...prev, mode: true }));
    sendCommand({ mode: newMode });
  };

  const handleConfigSave = (newConfig) => {
    setConfig(newConfig);
    sendCommand(newConfig);
    alert("Configuration Sent to Device");
  };

  const handleFirmwareUpdate = (url) => {
    if (!url) return;
    if (!confirm(`WARNING: This will update the device firmware from:\n${url}\n\nDo you want to proceed?`)) return;
    
    sendCommand({ update_url: url });
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
          <div className="header-title-group">
            <h1>{userDevices.find(d => d.deviceId === deviceId)?.name || deviceId}</h1>
            <span className="device-badge">{deviceId}</span>
          </div>
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
          <SensorCard title="CO2 Level" value={sensorData.co2} unit="ppm" icon={Wind} color="#8884d8" />
          <SensorCard title="Soil Moisture" value={sensorData.soil} unit="%" icon={Waves} color="#0088fe" />
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
      <Authenticator hideSignUp={true}>
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
