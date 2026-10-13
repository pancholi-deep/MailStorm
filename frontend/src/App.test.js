import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import Login from './components/Login';
import { exchangeCodeForTokens } from './utils/authApi';

jest.mock('./utils/authApi', () => ({ exchangeCodeForTokens: jest.fn() }));
// CRA's Jest resolver predates React Router 7's package exports.
jest.mock('react-router-dom', () => {
  const navigate = jest.fn();
  return { useNavigate: () => navigate };
}, { virtual: true });

let initCodeClient;
let requestCode;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  jest.clearAllMocks();
  requestCode = jest.fn();
  initCodeClient = jest.fn(() => ({ requestCode }));
  window.google = { accounts: { oauth2: { initCodeClient } } };
});

afterEach(() => {
  delete window.google;
});

function renderLogin({ clientId = 'test.apps.googleusercontent.com', googleScriptError = false } = {}) {
  render(
    <React.StrictMode>
      <GoogleOAuthProvider clientId={clientId}>
        <Login setUser={jest.fn()} googleScriptError={googleScriptError} />
      </GoogleOAuthProvider>
    </React.StrictMode>
  );
}

function loadGoogleScript() {
  fireEvent.load(document.querySelector('script[src="https://accounts.google.com/gsi/client"]'));
}

test('waits for the Google script before initializing login in Strict Mode', () => {
  delete window.google;
  renderLogin();
  expect(screen.getByRole('button', { name: /Loading Google sign-in/ })).toBeDisabled();
  expect(initCodeClient).not.toHaveBeenCalled();
  window.google = { accounts: { oauth2: { initCodeClient } } };
  loadGoogleScript();
  const button = screen.getByRole('button', { name: 'Sign in with Google' });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(requestCode).toHaveBeenCalledTimes(1);
});

test('missing client credentials do not initialize Google or crash the page', () => {
  renderLogin({ clientId: '' });
  loadGoogleScript();
  expect(initCodeClient).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('not configured');
  expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
});

test('script loading failure is shown without crashing login', () => {
  renderLogin({ googleScriptError: true });
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load Google sign-in');
  expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
});

test('OAuth errors are handled without exchanging an absent authorization code', async () => {
  renderLogin();
  loadGoogleScript();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
  await act(async () => initCodeClient.mock.calls[0][0].callback({ error: 'access_denied' }));
  expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('not completed');
  expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
});

test('a closed or blocked popup lets the user retry', () => {
  renderLogin();
  loadGoogleScript();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
  act(() => initCodeClient.mock.calls[0][0].error_callback({ type: 'popup_closed' }));
  expect(screen.getByRole('alert')).toHaveTextContent('could not open or was closed');
  expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
});

test('backend token exchange failures are shown without an unhandled rejection', async () => {
  exchangeCodeForTokens.mockRejectedValueOnce(new Error('Backend unavailable'));
  renderLogin();
  loadGoogleScript();
  await act(async () => initCodeClient.mock.calls[0][0].callback({ code: 'test-code' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to sign in');
  expect(localStorage.getItem('access_token')).toBeNull();
});

test('successful sign-in stores a tab session and removes legacy persistent credentials', async () => {
  localStorage.setItem('token', 'legacy');
  exchangeCodeForTokens.mockResolvedValueOnce({ user: { name: 'Alice', email: 'alice@gmail.com' }, access_token: 'google-token', expires_in: 3600 });
  renderLogin();
  loadGoogleScript();
  await act(async () => initCodeClient.mock.calls[0][0].callback({ code: 'test-code' }));
  expect(JSON.parse(sessionStorage.getItem('mailstorm_session')).access_token).toBe('google-token');
  expect(localStorage.getItem('access_token')).toBeNull();
  expect(localStorage.getItem('token')).toBeNull();
});
