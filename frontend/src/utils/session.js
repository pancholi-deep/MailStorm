const SESSION_KEY = 'mailstorm_session';

function clearLegacy() {
  try {
    ['user', 'token', 'access_token'].forEach(key => localStorage.removeItem(key));
  } catch { /* Storage may be disabled by the browser. */ }
}

export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage unavailable. */ }
  clearLegacy();
}

export function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (session?.user?.email && session.access_token && session.expires_at > Date.now()) {
      clearLegacy();
      return session;
    }
    // Migrate an existing login once; avoid leaving Gmail credentials in localStorage.
    const user = JSON.parse(localStorage.getItem('user'));
    const token = localStorage.getItem('access_token') || localStorage.getItem('token');
    if (!session && user?.email && token && token !== 'null' && token !== 'undefined') {
      return saveSession({ user, access_token: token, expires_in: 3600 });
    }
  } catch {
    // Corrupt or unavailable browser storage should never crash rendering.
  }
  clearSession();
  return null;
}

export function saveSession({ user, access_token, expires_in = 3600 }) {
  if (!user?.email || !access_token || !Number.isFinite(Number(expires_in)) || Number(expires_in) <= 0) {
    throw new Error('Google returned an incomplete or expired session.');
  }
  const session = { user, access_token, expires_at: Date.now() + Number(expires_in) * 1000 };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  clearLegacy();
  return session;
}

export function getAccessToken() {
  return readSession()?.access_token || null;
}
