import { backendURL, googleAuthPath } from './config';

export async function exchangeCodeForTokens(code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${backendURL}${googleAuthPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('Google sign-in failed. Please try again.');
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
