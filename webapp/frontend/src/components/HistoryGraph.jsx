import React, { useState } from 'react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush } from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="custom-tooltip" style={{ backgroundColor: '#333', padding: '10px', border: '1px solid #555', color: '#fff' }}>
        <p className="label">{`Time: ${label}`}</p>
        {payload.map((entry, index) => {
            // Format Boolean Values for Actuators
            let value = entry.value;
            if (entry.name.includes("Status")) {
                value = entry.value === 1 ? "ON" : "OFF";
            }
            return (
                <p key={index} style={{color: entry.color}}>
                    {`${entry.name}: ${value}`}
                </p>
            );
        })}
        <hr style={{borderColor: '#555', margin: '5px 0'}}/>
        <p>{`Mode: ${data.mode || 'AUTO'}`}</p>
      </div>
    );
  }
  return null;
};

const HistoryGraph = ({ data, onDateChange }) => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const handleDateChange = (e) => {
      const date = e.target.value;
      setSelectedDate(date);
      onDateChange(date);
  };

  const downloadCSV = () => {
    if (!data || data.length === 0) return;
    
    const headers = ['Time', 'Temperature', 'Humidity', 'Soil Moisture', 'Heater', 'Fan', 'Pump', 'Mode'];
    const csvRows = [headers.join(',')];
    
    data.forEach(row => {
        const values = [
            row.time,
            row.temp,
            row.hum,
            row.soil,
            row.heater ? 'ON' : 'OFF',
            row.fan ? 'ON' : 'OFF',
            row.pump ? 'ON' : 'OFF',
            row.mode || 'AUTO'
        ];
        csvRows.push(values.join(','));
    });
    
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `greenhouse_data_${selectedDate}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Calculate Actuator Activations (0 -> 1 transitions)
  const countActivations = (key) => {
    if (!data || data.length < 2) return 0;
    let count = 0;
    if (data[0][key]) count++;
    for (let i = 1; i < data.length; i++) {
      if (data[i][key] && !data[i-1][key]) count++;
    }
    return count;
  };

  const pumpCount = countActivations('pump');
  const fanCount = countActivations('fan');
  const heaterCount = countActivations('heater');

  return (
    <div className="history-container">
      <div className="history-header">
        <div className="analytics-controls">
            <h3>Analytics</h3>
            <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                <input 
                    type="date" 
                    value={selectedDate} 
                    onChange={handleDateChange}
                    className="date-picker"
                />
                <button onClick={downloadCSV} style={{
                    padding: '8px 12px', 
                    background: '#4CAF50', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '4px', 
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '0.9rem'
                }}>
                    Download CSV
                </button>
            </div>
        </div>
        <div className="daily-stats">
          <strong>Daily Activations:</strong> 
          <span className="stat-item pump">Pump: {pumpCount}</span>
          <span className="stat-item fan">Fan: {fanCount}</span>
          <span className="stat-item heater">Heater: {heaterCount}</span>
        </div>
      </div>

      {/* 1. Combined Overview */}
      <div className="graph-card" style={{marginBottom: '20px', background: '#1a1a1a', padding: '15px', borderRadius: '8px'}}>
        <h4 style={{textAlign: 'center', marginBottom: '15px'}}>Overview</h4>
        <div style={{ width: '100%', height: 250 }}>
            {(!data || data.length === 0) ? (
                <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666'}}>
                    No Data Available
                </div>
            ) : (
                <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} syncId="greenhouseGraph">
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="time" stroke="#666" tick={{fill: '#666'}} />
                    <YAxis stroke="#666" tick={{fill: '#666'}} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="temp" stroke="#ff7300" name="Temp (°C)" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="hum" stroke="#387908" name="Humidity (%)" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="soil" stroke="#0088fe" name="Soil (%)" dot={false} strokeWidth={2} />
                    <Brush dataKey="time" height={30} stroke="#8884d8" fill="#1a1a1a" />
                </LineChart>
                </ResponsiveContainer>
            )}
        </div>
      </div>

      <div className="detailed-graphs">
        {/* 2. Temperature & Heater */}
        <div className="graph-card" style={{background: '#1a1a1a', padding: '15px', borderRadius: '8px'}}>
            <h4 style={{textAlign: 'center', marginBottom: '15px'}}>Temperature & Heater</h4>
            <div style={{ width: '100%', height: 200 }}>
                {(!data || data.length === 0) ? (
                    <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666'}}>No Data</div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} syncId="greenhouseGraph">
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis dataKey="time" stroke="#666" tick={false} />
                        <YAxis yAxisId="left" stroke="#666" />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 1]} hide />
                        <Tooltip content={<CustomTooltip />} />
                        <Area yAxisId="left" type="monotone" dataKey="temp" stroke="#ff7300" fill="#ff7300" fillOpacity={0.3} name="Temp (°C)" />
                        <Area yAxisId="right" type="step" dataKey="heater" stroke="none" fill="#ff0000" fillOpacity={0.15} name="Heater Status" />
                    </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>

        {/* 3. Humidity & Fan */}
        <div className="graph-card" style={{background: '#1a1a1a', padding: '15px', borderRadius: '8px'}}>
            <h4 style={{textAlign: 'center', marginBottom: '15px'}}>Humidity & Fan</h4>
            <div style={{ width: '100%', height: 200 }}>
                {(!data || data.length === 0) ? (
                    <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666'}}>No Data</div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} syncId="greenhouseGraph">
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis dataKey="time" stroke="#666" tick={false} />
                        <YAxis yAxisId="left" stroke="#666" />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 1]} hide />
                        <Tooltip content={<CustomTooltip />} />
                        <Area yAxisId="left" type="monotone" dataKey="hum" stroke="#387908" fill="#387908" fillOpacity={0.3} name="Humidity (%)" />
                        <Area yAxisId="right" type="step" dataKey="fan" stroke="none" fill="#00ff00" fillOpacity={0.15} name="Fan Status" />
                    </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>

        {/* 4. Soil & Pump */}
        <div className="graph-card" style={{background: '#1a1a1a', padding: '15px', borderRadius: '8px'}}>
            <h4 style={{textAlign: 'center', marginBottom: '15px'}}>Soil Moisture & Pump</h4>
            <div style={{ width: '100%', height: 200 }}>
                {(!data || data.length === 0) ? (
                    <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666'}}>No Data</div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} syncId="greenhouseGraph">
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis dataKey="time" stroke="#666" tick={false} />
                        <YAxis yAxisId="left" stroke="#666" />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 1]} hide />
                        <Tooltip content={<CustomTooltip />} />
                        <Area yAxisId="left" type="monotone" dataKey="soil" stroke="#0088fe" fill="#0088fe" fillOpacity={0.3} name="Soil (%)" />
                        <Area yAxisId="right" type="step" dataKey="pump" stroke="none" fill="#0000ff" fillOpacity={0.15} name="Pump Status" />
                    </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default HistoryGraph;
