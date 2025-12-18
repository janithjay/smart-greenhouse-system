import React, { useState } from 'react';

const ConfigPanel = ({ config, onSave }) => {
  const [localConfig, setLocalConfig] = useState(config);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setLocalConfig(prev => ({
      ...prev,
      [name]: parseFloat(value)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(localConfig);
  };

  return (
    <div className="config-panel">
      <h3>Configuration</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Min Temp (Night) °C</label>
          <input 
            type="number" 
            name="temp_min" 
            value={localConfig.temp_min} 
            onChange={handleChange} 
            step="0.1"
          />
        </div>
        <div className="form-group">
          <label>Max Temp (Day) °C</label>
          <input 
            type="number" 
            name="temp_max" 
            value={localConfig.temp_max} 
            onChange={handleChange} 
            step="0.1"
          />
        </div>
        <div className="form-group">
          <label>Max Humidity %</label>
          <input 
            type="number" 
            name="hum_max" 
            value={localConfig.hum_max} 
            onChange={handleChange} 
            step="0.1"
          />
        </div>
        <div className="form-group">
          <label>Soil Dry Threshold %</label>
          <input 
            type="number" 
            name="soil_dry" 
            value={localConfig.soil_dry} 
            onChange={handleChange} 
          />
        </div>
        <div className="form-group">
          <label>Soil Wet Threshold %</label>
          <input 
            type="number" 
            name="soil_wet" 
            value={localConfig.soil_wet} 
            onChange={handleChange} 
          />
        </div>
        <button type="submit" className="save-btn">Save Settings</button>
      </form>
    </div>
  );
};

export default ConfigPanel;
