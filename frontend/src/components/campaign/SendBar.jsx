import React from 'react';

export default function SendBar({ user, sending, editorBusy, handleReset, handleCancelSending }) {
  return (
    <div className="send-bar">
      <div className="sender-info">
        <span className="sender-avatar" aria-hidden="true">
          {(user?.name || 'M').slice(0, 1).toUpperCase()}
        </span>
        <div>
          <span className="muted">Sending from</span>
          <strong>{user?.email}</strong>
        </div>
      </div>
      <div className="send-actions">
        {sending ? (
          <button type="button" className="ws-button" onClick={handleCancelSending}>
            Cancel Sending
          </button>
        ) : (
          <button type="button" className="ws-button" disabled={editorBusy} onClick={handleReset}>
            Reset
          </button>
        )}
        <button type="submit" className="ws-button primary send-button" disabled={editorBusy}>
          {sending ? 'Sending…' : 'Send Emails'}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    </div>
  );
}
