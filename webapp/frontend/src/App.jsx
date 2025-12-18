import React, { useState, useEffect } from 'react';
import { Thermometer, Droplets, Wind, Activity, Waves } from 'lucide-react';
import io from 'socket.io-client';
import SensorCard from './components/SensorCard';
import ControlPanel from './components/ControlPanel';
import ConfigPanel from './components/ConfigPanel';
import HistoryGraph from './components/HistoryGraph';
import './App.css';

// Connect to Backend
const socket = io('http://localhost:3001');

function App() {
  // --- State ---
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
    soil_wet: 70
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
    socket.on('connect', () => {
      console.log('Connected to Backend');
      setConnected(true);
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

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Smart Greenhouse</h1>
        <div className="status-group">
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
