import React from 'react';

export default function ThemeToggle({ darkMode, setDarkMode }) {
  return (
    <button
      type="button"
      className="theme-button"
      onClick={() => setDarkMode(!darkMode)}
      aria-label="Toggle dark mode"
      aria-pressed={darkMode}
      title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
    >
      <span aria-hidden="true">{darkMode ? '☀' : '☾'}</span>
    </button>
  );
}
