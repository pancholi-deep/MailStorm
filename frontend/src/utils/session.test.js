import { clearSession, getAccessToken, readSession, saveSession } from './session';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test('migrates legacy credentials out of persistent storage', () => {
  localStorage.setItem('user', JSON.stringify({ name: 'Alice', email: 'alice@gmail.com' }));
  localStorage.setItem('access_token', 'legacy-token');
  expect(readSession().access_token).toBe('legacy-token');
  expect(localStorage.getItem('access_token')).toBeNull();
  expect(localStorage.getItem('user')).toBeNull();
});

test('logout removes every credential key and tab session', () => {
  saveSession({ user: { email: 'alice@gmail.com' }, access_token: 'token' });
  ['token', 'access_token', 'user'].forEach((key) => localStorage.setItem(key, 'legacy'));
  clearSession();
  expect(sessionStorage.length).toBe(0);
  expect(localStorage.length).toBe(0);
  expect(getAccessToken()).toBeNull();
});

test('expired or corrupt sessions do not authenticate or crash rendering', () => {
  sessionStorage.setItem(
    'mailstorm_session',
    JSON.stringify({
      user: { email: 'alice@gmail.com' },
      access_token: 'token',
      expires_at: Date.now() - 1,
    })
  );
  expect(readSession()).toBeNull();
  sessionStorage.setItem('mailstorm_session', '{broken');
  localStorage.setItem('user', '{broken');
  expect(readSession()).toBeNull();
});
