// utils/authApi.js
const backendURL = process.env.REACT_APP_BACKEND_URL;
const googleAuthUrl = process.env.REACT_APP_GOOGLE_AUTH_ENDPOINT;

export async function exchangeCodeForTokens(code) {
  const res = await fetch(`${backendURL}${googleAuthUrl}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    throw new Error('Backend auth failed');
  }

  return res.json();
}
