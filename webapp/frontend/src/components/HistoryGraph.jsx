import React, { useState } from 'react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="custom-tooltip" style={{ backgroundColor: '#333', padding: '10px', border: '1px solid #555', color: '#fff' }}>
        <p className="label">{`Time: ${label}`}</p>
        {payload.map((entry, index) => (
            <p key={index} style={{color: entry.color}}>
                {`${entry.name}: ${entry.value}`}
            </p>
        ))}
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
      <div className="history-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '15px'}}>
            <h3 style={{margin: 0}}>Analytics</h3>
            <input 
                type="date" 
                value={selectedDate} 
                onChange={handleDateChange}
                style={{padding: '5px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#fff'}}
            />
        </div>
        <div style={{fontSize: '0.9em', color: '#ccc'}}>
          <strong>Daily Activations:</strong> 
          <span style={{marginLeft: '10px', color: '#0088fe'}}>Pump: {pumpCount}</span>
          <span style={{marginLeft: '10px', color: '#387908'}}>Fan: {fanCount}</span>
          <span style={{marginLeft: '10px', color: '#ff7300'}}>Heater: {heaterCount}</span>
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
                <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="time" stroke="#666" tick={{fill: '#666'}} />
                    <YAxis stroke="#666" tick={{fill: '#666'}} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="temp" stroke="#ff7300" name="Temp (°C)" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="hum" stroke="#387908" name="Humidity (%)" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="soil" stroke="#0088fe" name="Soil (%)" dot={false} strokeWidth={2} />
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
                    <AreaChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis dataKey="time" stroke="#666" tick={false} />
                        <YAxis stroke="#666" />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="temp" stroke="#ff7300" fill="#ff7300" fillOpacity={0.1} name="Temp (°C)" />
                        <Area type="step" dataKey="heater" stroke="#ff0000" fill="#ff0000" fillOpacity={0.2} name="Heater (On/Off)" />
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
                    <AreaChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis dataKey="time" stroke="#666" tick={false} />
                        <YAxis stroke="#666" />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="hum" stroke="#387908" fill="#387908" fillOpacity={0.1} name="Humidity (%)" />
                        <Area type="step" dataKey="fan" stroke="#00ff00" fill="#00ff00" fillOpacity={0.2} name="Fan (On/Off)" />
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
                    <AreaChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis dataKey="time" stroke="#666" tick={false} />
                        <YAxis stroke="#666" />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="soil" stroke="#0088fe" fill="#0088fe" fillOpacity={0.1} name="Soil (%)" />
                        <Area type="step" dataKey="pump" stroke="#0000ff" fill="#0000ff" fillOpacity={0.2} name="Pump (On/Off)" />
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
