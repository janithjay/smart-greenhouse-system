import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="custom-tooltip" style={{ backgroundColor: '#333', padding: '10px', border: '1px solid #555', color: '#fff' }}>
        <p className="label">{`Time: ${label}`}</p>
        <p>{`Temp: ${data.temp}°C`}</p>
        <p>{`Humidity: ${data.hum}%`}</p>
        <p>{`Soil: ${data.soil}%`}</p>
        <hr style={{borderColor: '#555', margin: '5px 0'}}/>
        <p>{`Mode: ${data.mode || 'AUTO'}`}</p>
        <p style={{color: data.pump ? '#0088fe' : '#aaa'}}>{`Pump: ${data.pump ? 'ON' : 'OFF'}`}</p>
        <p style={{color: data.fan ? '#387908' : '#aaa'}}>{`Fan: ${data.fan ? 'ON' : 'OFF'}`}</p>
        <p style={{color: data.heater ? '#ff7300' : '#aaa'}}>{`Heater: ${data.heater ? 'ON' : 'OFF'}`}</p>
      </div>
    );
  }
  return null;
};

const HistoryGraph = ({ data }) => {
  // Calculate Actuator Activations (0 -> 1 transitions)
  const countActivations = (key) => {
    if (!data || data.length < 2) return 0;
    let count = 0;
    // Check first point
    if (data[0][key]) count++;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][key] && !data[i-1][key]) {
        count++;
      }
    }
    return count;
  };

  const pumpCount = countActivations('pump');
  const fanCount = countActivations('fan');
  const heaterCount = countActivations('heater');

  return (
    <div className="history-graph">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
        <h3 style={{margin: 0}}>Sensor History</h3>
        <div style={{fontSize: '0.85em', color: '#ccc'}}>
          <strong>Activations:</strong> 
          <span style={{marginLeft: '10px', color: '#0088fe'}}>Pump: {pumpCount}</span>
          <span style={{marginLeft: '10px', color: '#387908'}}>Fan: {fanCount}</span>
          <span style={{marginLeft: '10px', color: '#ff7300'}}>Heater: {heaterCount}</span>
        </div>
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#444" />
            <XAxis 
              dataKey="time" 
              stroke="#888" 
              tick={{fill: '#888'}}
            />
            <YAxis stroke="#888" tick={{fill: '#888'}} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line type="monotone" dataKey="temp" stroke="#ff7300" name="Temp (°C)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="hum" stroke="#387908" name="Humidity (%)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="soil" stroke="#0088fe" name="Soil (%)" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default HistoryGraph;
