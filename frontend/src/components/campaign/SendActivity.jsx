import React from 'react';

export default function SendActivity({ logs, sending, handleDownloadLogs }) {
  return (
    <section className="activity-section" aria-labelledby="activity-heading">
      <div className="activity-heading">
        <h2 id="activity-heading">
          <span className={`activity-dot ${sending ? 'is-active' : ''}`} />
          Send activity
        </h2>
        {logs.length > 0 && (
          <button type="button" className="ws-button" onClick={handleDownloadLogs}>
            Download Logs
          </button>
        )}
      </div>
      <div
        className={`activity-log ${logs.length ? 'has-logs' : ''}`}
        role="log"
        aria-label="Delivery logs"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
      >
        {logs.length ? (
          logs.map((log, idx) => <p key={idx}>{log}</p>)
        ) : (
          <p>When you send, delivery updates will appear here.</p>
        )}
      </div>
    </section>
  );
}
