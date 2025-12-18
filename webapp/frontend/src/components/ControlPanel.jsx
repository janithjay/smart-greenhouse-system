import React from 'react';
import { Power, Fan, Droplets, ThermometerSun, Loader2 } from 'lucide-react';

const ControlPanel = ({ mode, setMode, devices, toggleDevice, loading }) => {
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
            disabled={loading.mode}
          />
          <span className="slider round"></span>
        </label>
        <span>Manual</span>
        {loading.mode && <Loader2 className="spinner" size={16} />}
      </div>

      <div className="device-grid">
        <button 
          className={`device-btn ${devices.pump ? 'active' : ''} ${loading.pump ? 'loading' : ''}`}
          onClick={() => toggleDevice('pump')}
          disabled={!isManual || loading.pump}
        >
          {loading.pump ? <Loader2 className="spinner" size={24} /> : <Droplets size={24} />}
          <span>Water Pump</span>
          <div className="status-dot"></div>
        </button>

        <button 
          className={`device-btn ${devices.fan ? 'active' : ''} ${loading.fan ? 'loading' : ''}`}
          onClick={() => toggleDevice('fan')}
          disabled={!isManual || loading.fan}
        >
          {loading.fan ? <Loader2 className="spinner" size={24} /> : <Fan size={24} />}
          <span>Exhaust Fan</span>
          <div className="status-dot"></div>
        </button>

        <button 
          className={`device-btn ${devices.heater ? 'active' : ''} ${loading.heater ? 'loading' : ''}`}
          onClick={() => toggleDevice('heater')}
          disabled={!isManual || loading.heater}
        >
          {loading.heater ? <Loader2 className="spinner" size={24} /> : <ThermometerSun size={24} />}
          <span>Heater</span>
          <div className="status-dot"></div>
        </button>
      </div>
    </div>
  );
};

export default ControlPanel;
