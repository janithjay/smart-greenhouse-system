import React, { useState } from 'react';
import { Save, UploadCloud, AlertTriangle, FileText } from 'lucide-react';

const ConfigPanel = ({ config, onSave, onUpdateFirmware, currentVersion, onViewLogs }) => {
  const [localConfig, setLocalConfig] = useState(config);
  const [errors, setErrors] = useState({});
  const [updateUrl, setUpdateUrl] = useState('');
  const [showUpdate, setShowUpdate] = useState(false);

  const validate = (values) => {
    const newErrors = {};

    if (values.temp_min < 0 || values.temp_min > 100) newErrors.temp_min = "Must be 0-100°C";
    if (values.temp_max < 0 || values.temp_max > 100) newErrors.temp_max = "Must be 0-100°C";
    if (values.hum_max < 0 || values.hum_max > 100) newErrors.hum_max = "Must be 0-100%";
    if (values.soil_dry < 0 || values.soil_dry > 100) newErrors.soil_dry = "Must be 0-100%";
    if (values.soil_wet < 0 || values.soil_wet > 100) newErrors.soil_wet = "Must be 0-100%";

    if (values.tank_empty_dist <= 0 || values.tank_empty_dist >= 500) newErrors.tank_empty_dist = "Must be 1-1000 cm";
    if (values.tank_full_dist <= 0 || values.tank_full_dist >= 500) newErrors.tank_full_dist = "Must be 1-1000 cm";

    // Logical checks
    if (values.temp_min >= values.temp_max) newErrors.temp_min = "Min Temp must be less than Max Temp";
    if (values.soil_dry >= values.soil_wet) newErrors.soil_dry = "Dry threshold must be less than Wet threshold";
    if (values.tank_full_dist >= values.tank_empty_dist) newErrors.tank_full_dist = "Full distance must be less than Empty distance";

    return newErrors;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setLocalConfig(prev => ({
      ...prev,
      [name]: parseFloat(value)
    }));
    // Clear error when user types
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: null }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validationErrors = validate(localConfig);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    onSave(localConfig);
  };

  const handleUpdateSubmit = (e) => {
    e.preventDefault();
    onUpdateFirmware(updateUrl);
    setUpdateUrl('');
    setShowUpdate(false);
  };

  return (
    <div className="config-panel">
      <div className="config-header">
        <h3 style={{ margin: 0 }}>Configuration</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button 
                onClick={onViewLogs} 
                title="View System Logs"
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}
            >
                <FileText size={16} />
            </button>
            <div style={{ fontSize: '0.8em', color: '#888' }}>
            FW: <span style={{ color: '#fff' }}>{currentVersion || '...'}</span>
            </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Min Temp (Night) °C</label>
          <input
            type="number"
            name="temp_min"
            value={localConfig.temp_min}
            onChange={handleChange}
            step="0.1"
            className={errors.temp_min ? 'error' : ''}
          />
          {errors.temp_min && <span className="error-msg">{errors.temp_min}</span>}
        </div>
        <div className="form-group">
          <label>Max Temp (Day) °C</label>
          <input
            type="number"
            name="temp_max"
            value={localConfig.temp_max}
            onChange={handleChange}
            step="0.1"
            className={errors.temp_max ? 'error' : ''}
          />
          {errors.temp_max && <span className="error-msg">{errors.temp_max}</span>}
        </div>
        <div className="form-group">
          <label>Max Humidity %</label>
          <input
            type="number"
            name="hum_max"
            value={localConfig.hum_max}
            onChange={handleChange}
            step="0.1"
            className={errors.hum_max ? 'error' : ''}
          />
          {errors.hum_max && <span className="error-msg">{errors.hum_max}</span>}
        </div>
        <div className="form-group">
          <label>Soil Dry Threshold %</label>
          <input
            type="number"
            name="soil_dry"
            value={localConfig.soil_dry}
            onChange={handleChange}
            className={errors.soil_dry ? 'error' : ''}
          />
          {errors.soil_dry && <span className="error-msg">{errors.soil_dry}</span>}
        </div>
        <div className="form-group">
          <label>Soil Wet Threshold %</label>
          <input
            type="number"
            name="soil_wet"
            value={localConfig.soil_wet}
            onChange={handleChange}
            className={errors.soil_wet ? 'error' : ''}
          />
          {errors.soil_wet && <span className="error-msg">{errors.soil_wet}</span>}
        </div>
        <div className="form-group">
          <label>Tank Empty Distance (cm)</label>
          <input
            type="number"
            name="tank_empty_dist"
            value={localConfig.tank_empty_dist}
            onChange={handleChange}
            className={errors.tank_empty_dist ? 'error' : ''}
          />
          {errors.tank_empty_dist && <span className="error-msg">{errors.tank_empty_dist}</span>}
        </div>
        <div className="form-group">
          <label>Tank Full Distance (cm)</label>
          <input
            type="number"
            name="tank_full_dist"
            value={localConfig.tank_full_dist}
            onChange={handleChange}
            className={errors.tank_full_dist ? 'error' : ''}
          />
          {errors.tank_full_dist && <span className="error-msg">{errors.tank_full_dist}</span>}
        </div>
        
        <hr style={{ borderColor: '#333', margin: '20px 0' }} />
        <h4 style={{ marginBottom: '15px', color: '#4CAF50' }}>⏱️ Pump Schedules</h4>
        <div style={{ marginBottom: '20px' }}>
          {localConfig.schedules && localConfig.schedules.length > 0 ? (
            localConfig.schedules.map((schedule, i) => (
              <div key={i} style={{ padding: '10px', background: '#111', border: '1px solid #444', borderRadius: '4px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontWeight: 'bold', color: '#aaa' }}>Alarm {i + 1}</span>
                  <button 
                    type="button" 
                    onClick={() => {
                      const newSchedules = [...localConfig.schedules];
                      newSchedules.splice(i, 1);
                      setLocalConfig({...localConfig, schedules: newSchedules});
                    }}
                    style={{ background: '#ff4444', color: 'white', border: 'none', borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    &times;
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '15px', marginBottom: '10px' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>ON Time</label>
                    <input
                      type="time"
                      value={schedule.on_time || "08:00"}
                      onChange={(e) => {
                        const newSchedules = [...localConfig.schedules];
                        newSchedules[i] = {...newSchedules[i], on_time: e.target.value};
                        setLocalConfig({...localConfig, schedules: newSchedules});
                      }}
                      style={{ padding: '8px', background: '#222', color: 'white', border: '1px solid #444', borderRadius: '4px', width: '100%' }}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>OFF Time</label>
                    <input
                      type="time"
                      value={schedule.off_time || "08:15"}
                      onChange={(e) => {
                        const newSchedules = [...localConfig.schedules];
                        newSchedules[i] = {...newSchedules[i], off_time: e.target.value};
                        setLocalConfig({...localConfig, schedules: newSchedules});
                      }}
                      style={{ padding: '8px', background: '#222', color: 'white', border: '1px solid #444', borderRadius: '4px', width: '100%' }}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.8em', color: '#888' }}>Active Days (0=Sun, 6=Sat):</label>
                   <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, dayIdx) => {
                      const isActive = schedule.days && schedule.days.includes(dayIdx);
                      return (
                        <button
                          key={dayIdx}
                          type="button"
                          onClick={() => {
                            const newSchedules = [...localConfig.schedules];
                            let currDays = newSchedules[i].days || [];
                            if (isActive) {
                              currDays = currDays.filter(d => d !== dayIdx);
                            } else {
                              currDays = [...currDays, dayIdx].sort((a,b) => a-b);
                            }
                            newSchedules[i] = {...newSchedules[i], days: currDays};
                            setLocalConfig({...localConfig, schedules: newSchedules});
                          }}
                          style={{
                            background: isActive ? '#4CAF50' : '#333',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '26px',
                            height: '26px',
                            fontSize: '0.8em',
                            cursor: 'pointer'
                          }}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: '#888', fontStyle: 'italic', fontSize: '0.9em', textAlign: 'center', padding: '10px' }}>
              No pump schedules added. Pump will only trigger manually or automatically via soil thresholds.
            </div>
          )}
          <button 
            type="button"
            onClick={() => {
              const newSchedules = [...(localConfig.schedules || [])];
              newSchedules.push({ on_time: "08:00", off_time: "08:15", days: [0, 1, 2, 3, 4, 5, 6] });
              setLocalConfig({...localConfig, schedules: newSchedules});
            }}
            style={{ width: '100%', padding: '10px', background: '#2196F3', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: '5px', fontWeight: 'bold' }}
          >
            + Add Pump Alarm
          </button>
        </div>

        <button type="submit" className="save-btn">
          <Save size={16} style={{ marginRight: '5px' }} /> Save Settings
        </button>
      </form>

      <hr style={{ borderColor: '#333', margin: '20px 0' }} />

      <div className="firmware-section">
        <button
          type="button"
          className="update-toggle-btn"
          onClick={() => setShowUpdate(!showUpdate)}
          style={{ background: 'transparent', border: '1px solid #444', color: '#888', width: '100%', padding: '8px', cursor: 'pointer' }}
        >
          {showUpdate ? 'Cancel Update' : 'Advanced: Firmware Update'}
        </button>

        {showUpdate && (
          <div className="update-form" style={{ marginTop: '15px', background: '#222', padding: '10px', borderRadius: '5px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#ffaa00', fontSize: '0.85em', marginBottom: '10px' }}>
              <AlertTriangle size={16} />
              <span>Device will reboot after update.</span>
            </div>
            <form onSubmit={handleUpdateSubmit}>
              <input
                type="url"
                placeholder="https://example.com/firmware.bin"
                value={updateUrl}
                onChange={(e) => setUpdateUrl(e.target.value)}
                required
                style={{ width: '100%', padding: '8px', marginBottom: '10px', background: '#111', border: '1px solid #444', color: '#fff' }}
              />
              <button type="submit" style={{ width: '100%', background: '#d32f2f', color: 'white', border: 'none', padding: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                <UploadCloud size={16} /> Install Firmware
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfigPanel;
