import React from 'react';
import { X, AlertTriangle, Info } from 'lucide-react';

const AlertLog = ({ alerts, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '600px', width: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3>System Logs & Alerts</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>
        
        <div className="logs-list" style={{ overflowY: 'auto', flex: 1 }}>
          {alerts.length === 0 ? (
            <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No alerts found.</p>
          ) : (
            alerts.map((alert, index) => (
              <div key={index} style={{ 
                background: '#222', 
                padding: '10px', 
                marginBottom: '10px', 
                borderRadius: '5px',
                borderLeft: `4px solid ${alert.alert === 'ROLLBACK_EXECUTED' ? '#ff4444' : '#4488ff'}`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontWeight: 'bold', color: alert.alert === 'ROLLBACK_EXECUTED' ? '#ff4444' : '#4488ff', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {alert.alert === 'ROLLBACK_EXECUTED' ? <AlertTriangle size={14} /> : <Info size={14} />}
                    {alert.alert}
                  </span>
                  <span style={{ fontSize: '0.8em', color: '#888' }}>
                    {new Date(alert.timestamp * 1000).toLocaleString()}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '0.9em', color: '#ddd' }}>{alert.message}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AlertLog;
