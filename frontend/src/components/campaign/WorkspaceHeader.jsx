import React from 'react';

export default function WorkspaceHeader({
  user,
  darkMode,
  setDarkMode,
  handleLogout,
  libraryBusy,
  processing,
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
        <button
          type="button"
          className="ws-button theme-button"
          onClick={() => setDarkMode(!darkMode)}
          aria-label="Toggle dark mode"
          aria-pressed={darkMode}
        >
          {darkMode ? '☀' : '☾'}
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
