import React from 'react';
import { Power, Fan, Droplets, ThermometerSun } from 'lucide-react';

const ControlPanel = ({ mode, setMode, devices, toggleDevice }) => {
  const isManual = mode === 'MANUAL';

  return (
    <div className="control-panel">
      <h3>System Control</h3>
      
      <div className="mode-switch">
        <span>Auto</span>
        <label className="switch">
          <input 
            type="checkbox" 
            checked={isManual} 
            onChange={(e) => setMode(e.target.checked ? 'MANUAL' : 'AUTO')} 
          />
          <span className="slider round"></span>
        </label>
        <span>Manual</span>
      </div>

      <div className="device-grid">
        <button 
          className={`device-btn ${devices.pump ? 'active' : ''}`}
          onClick={() => toggleDevice('pump')}
          disabled={!isManual}
        >
          <Droplets size={24} />
          <span>Water Pump</span>
          <div className="status-dot"></div>
        </button>

        <button 
          className={`device-btn ${devices.fan ? 'active' : ''}`}
          onClick={() => toggleDevice('fan')}
          disabled={!isManual}
        >
          <Fan size={24} />
          <span>Exhaust Fan</span>
          <div className="status-dot"></div>
        </button>

        <button 
          className={`device-btn ${devices.heater ? 'active' : ''}`}
          onClick={() => toggleDevice('heater')}
          disabled={!isManual}
        >
          <ThermometerSun size={24} />
          <span>Heater</span>
          <div className="status-dot"></div>
        </button>
      </div>
    </div>
  );
};

export default ControlPanel;
