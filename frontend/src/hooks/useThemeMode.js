import { useEffect, useState } from 'react';

export default function useThemeMode() {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('mailstorm_theme') === 'dark';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('mailstorm_theme', darkMode ? 'dark' : 'light');
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }
  }, [darkMode]);
  return [darkMode, setDarkMode];
}
