import React from 'react';
import ThemeToggle from '../ThemeToggle';

export default function WorkspaceHeader({
  user,
  darkMode,
  setDarkMode,
  handleLogout,
  libraryBusy,
  processing,
  gmailStatus,
  gmailBusy,
  handleDisconnect,
  handleReconnect,
}) {
  return (
    <header className="workspace-topbar">
      <div className="workspace-brand">
        <img src="/mailstorm.png" alt="" />
        <span>MailStorm</span>
        <span className="brand-divider" />
        <span className="brand-caption">Mass Mailer</span>
      </div>
      <div className="account-actions">
        <span className="account-name">{user?.name}</span>
        <ThemeToggle darkMode={darkMode} setDarkMode={setDarkMode} />
        <button
          type="button"
          className="ws-button"
          onClick={gmailStatus?.connected ? handleDisconnect : handleReconnect}
          disabled={!gmailStatus || libraryBusy || processing || gmailBusy}
        >
          {gmailBusy
            ? 'Disconnecting…'
            : !gmailStatus
              ? 'Checking Gmail…'
              : gmailStatus.connected
                ? 'Disconnect Gmail'
                : 'Reconnect Gmail'}
        </button>
        <button
          type="button"
          className="ws-button"
          onClick={handleLogout}
          disabled={libraryBusy || processing}
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
