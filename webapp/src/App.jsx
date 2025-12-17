import React, { useState, useEffect } from 'react';
import { Thermometer, Droplets, Wind, Activity, Waves } from 'lucide-react';
import SensorCard from './components/SensorCard';
import ControlPanel from './components/ControlPanel';
import ConfigPanel from './components/ConfigPanel';
import HistoryGraph from './components/HistoryGraph';
import './App.css';

function App() {
  // --- State ---
  const [sensorData, setSensorData] = useState({
    temp: 24.5,
    hum: 65,
    soil: 45,
    co2: 420,
    tank_level: 85,
    timestamp: Date.now()
  });

  const [devices, setDevices] = useState({
    pump: false,
    fan: false,
    heater: false
  });

  const [mode, setMode] = useState('AUTO'); // 'AUTO' or 'MANUAL'

  const [config, setConfig] = useState({
    temp_min: 20.0,
    temp_max: 30.0,
    soil_dry: 40,
    soil_wet: 70
  });

  const [history, setHistory] = useState([]);

  // --- Simulation Effect (Mock Data) ---
  useEffect(() => {
    const interval = setInterval(() => {
      setSensorData(prev => {
        const newData = {
          ...prev,
          temp: parseFloat((prev.temp + (Math.random() - 0.5)).toFixed(1)),
          hum: Math.min(100, Math.max(0, Math.floor(prev.hum + (Math.random() * 4 - 2)))),
          soil: Math.min(100, Math.max(0, Math.floor(prev.soil + (Math.random() * 2 - 1)))),
          co2: Math.max(400, prev.co2 + Math.floor(Math.random() * 10 - 5)),
          timestamp: Date.now()
        };

        // Update History
        setHistory(prevHist => {
          const newHist = [...prevHist, {
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            temp: newData.temp,
            hum: newData.hum,
            soil: newData.soil
          }];
          if (newHist.length > 20) newHist.shift(); // Keep last 20 points
          return newHist;
        });

        return newData;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // --- Handlers ---
  const handleDeviceToggle = (device) => {
    if (mode === 'AUTO') return;
    setDevices(prev => ({
      ...prev,
      [device]: !prev[device]
    }));
  };

  const handleConfigSave = (newConfig) => {
    setConfig(newConfig);
    alert("Configuration Saved (Simulated)");
    console.log("New Config:", newConfig);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Smart Greenhouse</h1>
        <div className="connection-status online">
          <div className="dot"></div> Online
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
            setMode={setMode} 
            devices={devices} 
            toggleDevice={handleDeviceToggle} 
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
