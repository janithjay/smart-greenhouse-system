import React from 'react';
import { Divide } from 'lucide-react';

const SensorCard = ({ title, value, unit, icon: Icon, color, status }) => {
  return (
    <div className="sensor-card" style={{ borderTop: `4px solid ${color}` }}>
      <div className="sensor-header">
        <span className="sensor-title">{title}</span>
        {Icon && <Icon size={20} color={color} />}
      </div>
      <div className="sensor-body">
        <span className="sensor-value">{value}</span>
        <span className="sensor-unit">{unit}</span>
      </div>
      {status && (
        <div className={`sensor-status ${status.toLowerCase()}`}>
          {status}
        </div>
      )}
    </div>
  );
};

export default SensorCard;
