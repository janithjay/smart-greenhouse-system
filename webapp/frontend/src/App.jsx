import React, { useState, useEffect } from 'react';
import { Thermometer, Droplets, Wind, Activity, Waves } from 'lucide-react';
import io from 'socket.io-client';
import SensorCard from './components/SensorCard';
import ControlPanel from './components/ControlPanel';
import ConfigPanel from './components/ConfigPanel';
import HistoryGraph from './components/HistoryGraph';
import './App.css';

// Connect to Backend
// Dynamically determine the backend URL based on the current hostname
// This allows access from localhost or local IP (e.g., 192.168.x.x)
const BACKEND_PORT = 3001;
const socket = io(`http://${window.location.hostname}:${BACKEND_PORT}`);

function App() {
  // --- State ---
  const [deviceId, setDeviceId] = useState(localStorage.getItem('greenhouse_device_id') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('greenhouse_device_id'));
  
  const [sensorData, setSensorData] = useState({
    temp: 0,
    hum: 0,
    soil: 0,
    co2: 0,
    tank_level: 0,
    timestamp: Date.now()
  });

  const [devices, setDevices] = useState({
    pump: false,
    fan: false,
    heater: false
  });

  const [mode, setMode] = useState('AUTO'); // 'AUTO' or 'MANUAL'
  const [connected, setConnected] = useState(false);
  const [deviceOnline, setDeviceOnline] = useState(false);

  const [config, setConfig] = useState({
    temp_min: 20.0,
    temp_max: 30.0,
    hum_max: 75.0,
    soil_dry: 40,
    soil_wet: 70,
    tank_empty_dist: 25,
    tank_full_dist: 5
  });

  const [history, setHistory] = useState([]);
  
  // Loading states for UI feedback
  const [loading, setLoading] = useState({
    pump: false,
    fan: false,
    heater: false,
    mode: false
  });

  // --- Socket.io Effect ---
  useEffect(() => {
    if (isLoggedIn && deviceId) {
        socket.emit('join-device', deviceId);
    }

    socket.on('connect', () => {
      console.log('Connected to Backend');
      setConnected(true);
      if (isLoggedIn && deviceId) {
          socket.emit('join-device', deviceId);
      }
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from Backend');
      setConnected(false);
      setDeviceOnline(false);
    });

    socket.on('device-status', (status) => {
      console.log('Device Status:', status);
      setDeviceOnline(status.online);
    });

    socket.on('config-error', (err) => {
      alert(err.message);
    });

    socket.on('sensor-data', (data) => {
      console.log('Data:', data);
      setSensorData(data);
      
      // Update Device States from real data
      setDevices({
        pump: data.pump === 1,
        fan: data.fan === 1,
        heater: data.heater === 1
      });

      if (data.mode) {
        setMode(data.mode);
      }
      
      // Clear loading states when we receive fresh data
      setLoading({
        pump: false,
        fan: false,
        heater: false,
        mode: false
      });

      // Update History
      setHistory(prevHist => {
        const newHist = [...prevHist, {
          time: new Date(data.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          temp: data.temp,
          hum: data.hum,
          soil: data.soil
        }];
        if (newHist.length > 20) newHist.shift(); 
        return newHist;
      });
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('device-status');
      socket.off('config-error');
      socket.off('sensor-data');
    };
  }, []);

  // --- Handlers ---
  const handleDeviceToggle = (device) => {
    if (mode === 'AUTO') return;
    
    const newState = !devices[device];
    
    // Set loading state
    setLoading(prev => ({ ...prev, [device]: true }));

    // Send Command to Backend
    // We do NOT update state here (Optimistic UI). 
    // We wait for the backend to send back the new state via 'sensor-data'.
    socket.emit('control-command', { [device]: newState ? 1 : 0 });
  };

  const handleModeToggle = (newMode) => {
      // Set loading state
      setLoading(prev => ({ ...prev, mode: true }));

      // Send Command to Backend
      // Wait for confirmation via 'sensor-data' before updating UI
      socket.emit('control-command', { mode: newMode });
  };

  const handleConfigSave = (newConfig) => {
    setConfig(newConfig);
    socket.emit('config-update', newConfig);
    alert("Configuration Sent to Device");
  };

  const handleLogin = (e) => {
      e.preventDefault();
      const id = e.target.elements.deviceId.value.trim();
      if (id) {
          setDeviceId(id);
          setIsLoggedIn(true);
          localStorage.setItem('greenhouse_device_id', id);
          socket.emit('join-device', id);
      }
  };

  const handleLogout = () => {
      setIsLoggedIn(false);
      setDeviceId('');
      localStorage.removeItem('greenhouse_device_id');
      window.location.reload();
  };

  if (!isLoggedIn) {
      return (
          <div className="login-container">
              <div className="login-box">
                  <h1>Smart Greenhouse</h1>
                  <p>Enter your Device ID to connect</p>
                  <form onSubmit={handleLogin}>
                      <input type="text" name="deviceId" placeholder="e.g. GH-A1B2C3" required />
                      <button type="submit">Connect</button>
                  </form>
              </div>
          </div>
      );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Smart Greenhouse <span className="device-badge">{deviceId}</span></h1>
        <div className="status-group">
            <button onClick={handleLogout} className="logout-btn">Logout</button>
            <div className={`connection-status ${connected ? 'online' : 'offline'}`}>
                <div className="dot"></div> Server: {connected ? 'Connected' : 'Disconnected'}
            </div>
            <div className={`connection-status ${deviceOnline ? 'online' : 'offline'}`}>
                <div className="dot"></div> Device: {deviceOnline ? 'Online' : 'Offline'}
            </div>
            <div className="last-updated">
                Last Data: {sensorData.timestamp ? new Date(sensorData.timestamp * 1000).toLocaleTimeString() : 'Never'}
            </div>
        </div>
      </header>

      <main className="dashboard-grid">
        {/* Row 1: Sensors */}
        <section className="sensors-section">
          <SensorCard 
            title="Temperature" 
            value={sensorData.temp} 
            unit="°C" 
            icon={Thermometer} 
            color="#ff7300" 
          />
          <SensorCard 
            title="Humidity" 
            value={sensorData.hum} 
            unit="%" 
            icon={Droplets} 
            color="#387908" 
          />
          <SensorCard 
            title="Soil Moisture" 
            value={sensorData.soil} 
            unit="%" 
            icon={Waves} 
            color="#0088fe" 
          />
          <SensorCard 
            title="CO2 Level" 
            value={sensorData.co2} 
            unit="ppm" 
            icon={Wind} 
            color="#8884d8" 
          />
          <SensorCard 
            title="Tank Level" 
            value={sensorData.tank_level} 
            unit="%" 
            icon={Activity} 
            color="#00C49F" 
          />
        </section>

        {/* Row 2: Controls & Config */}
        <section className="controls-section">
          <ControlPanel 
            mode={mode} 
            setMode={handleModeToggle} 
            devices={devices} 
            toggleDevice={handleDeviceToggle} 
            loading={loading}
          />
          <ConfigPanel 
            config={config} 
            onSave={handleConfigSave} 
          />
        </section>

        {/* Row 3: Graphs */}
        <section className="graph-section">
          <HistoryGraph data={history} />
        </section>
      </main>
    </div>
  );
}

export default App;
