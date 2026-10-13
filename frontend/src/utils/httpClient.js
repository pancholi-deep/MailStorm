import { backendURL } from './config';
import { getAccessToken } from './session';

export async function request(path, options = {}) {
  const token = getAccessToken();
  if (!token)
    throw Object.assign(new Error('Your session has expired. Please sign in again.'), {
      status: 401,
    });
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    options.method === 'PUT' ? 120000 : 45000
  );
  let response;
  try {
    response = await fetch(`${backendURL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
    });
  } catch (error) {
    if (timedOut)
      throw new Error('Request timed out. Reload to check campaign progress before retrying.');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw Object.assign(
      new Error(
        typeof data?.detail === 'string' ? data.detail : 'Request failed. Please try again.'
      ),
      { status: response.status }
    );
  }
  return response;
}
export const jsonRequest = async (path, options) => (await request(path, options)).json();
export const jsonBody = (value, method = 'POST') => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
  method,
});
