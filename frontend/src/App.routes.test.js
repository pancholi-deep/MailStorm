import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/authContext';
import { saveSession } from './utils/session';

jest.mock('./components/Login', () => () => <div>Login screen</div>);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] })); });
afterEach(() => { delete global.fetch; });

function renderRoute(path) {
  render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

test('unauthenticated access redirects to login', () => {
  renderRoute('/emailform');
  expect(screen.getByText('Login screen')).toBeInTheDocument();
});

test('authenticated root reaches the existing email UI, and logout clears credentials', async () => {
  saveSession({ user: { name: 'Alice', email: 'alice@gmail.com' }, access_token: 'test-token' });
  renderRoute('/');
  expect(screen.getByText('Mass Mailer')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
  expect(await screen.findByText('Login screen')).toBeInTheDocument();
  expect(sessionStorage.getItem('mailstorm_session')).toBeNull();
});

test('corrupted stored user does not crash the app', () => {
  localStorage.setItem('user', '{broken');
  renderRoute('/');
  expect(screen.getByText('Login screen')).toBeInTheDocument();
});

test('legacy callback does not exchange codes against localhost', () => {
  renderRoute('/oauth/callback?code=unused');
  expect(screen.getByText('Login screen')).toBeInTheDocument();
});
