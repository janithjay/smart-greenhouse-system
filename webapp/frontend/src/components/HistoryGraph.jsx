import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const HistoryGraph = ({ data }) => {
  return (
    <div className="history-graph">
      <h3>Sensor History</h3>
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
            <Tooltip 
              contentStyle={{ backgroundColor: '#333', border: 'none' }}
              itemStyle={{ color: '#fff' }}
            />
            <Legend />
            <Line type="monotone" dataKey="temp" stroke="#ff7300" name="Temp (°C)" dot={false} />
            <Line type="monotone" dataKey="hum" stroke="#387908" name="Humidity (%)" dot={false} />
            <Line type="monotone" dataKey="soil" stroke="#0088fe" name="Soil (%)" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default HistoryGraph;
