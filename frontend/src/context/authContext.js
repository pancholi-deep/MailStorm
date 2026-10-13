import React, { createContext, useCallback, useEffect, useState } from 'react';
import { request } from '../utils/httpClient';
import { clearSession, readSession } from '../utils/session';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => readSession()?.user || null);
  const logout = useCallback(() => {
    request('/v1/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    setUser(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    const checkSession = () => {
      if (!readSession()) logout();
    };
    const remaining = (readSession()?.expires_at || Date.now()) - Date.now();
    const timer = setTimeout(checkSession, Math.min(Math.max(remaining, 0), 2147483647));
    window.addEventListener('focus', checkSession);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', checkSession);
    };
  }, [user, logout]);

  return <AuthContext.Provider value={{ user, setUser, logout }}>{children}</AuthContext.Provider>;
};
