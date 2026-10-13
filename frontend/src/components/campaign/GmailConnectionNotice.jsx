import React from 'react';

export default function GmailConnectionNotice({ status, error, refresh }) {
  if (error) {
    return (
      <div className="gmail-notice" role="alert">
        <span>{error}</span>
        <button type="button" className="ws-button" onClick={refresh}>
          Retry connection check
        </button>
      </div>
    );
  }
  if (!status || status.connected) return null;
  return (
    <div className="gmail-notice" role="status">
      <p>
        Gmail is disconnected. You can still edit and save campaigns. Reconnect Gmail to send
        emails.
      </p>
      {status.revocation_pending && (
        <p>
          Stored Gmail tokens have been removed, but Google revocation could not be confirmed.{' '}
          <a
            href="https://myaccount.google.com/connections"
            target="_blank"
            rel="noopener noreferrer"
          >
            Remove MailStorm access in your Google account
          </a>
          .
        </p>
      )}
    </div>
  );
}
