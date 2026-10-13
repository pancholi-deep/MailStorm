import { backendURL } from './config';
import { getAccessToken } from './session';
import sha256 from 'node-forge/lib/sha256';

export async function request(path, options = {}) {
  const token = getAccessToken();
  if (!token) throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.method === 'PUT' ? 120000 : 45000);
  let response;
  try {
    response = await fetch(`${backendURL}${path}`, {
      ...options, signal: controller.signal, headers: { Authorization: `Bearer ${token}`, ...options.headers },
    });
  } catch (error) {
    if (timedOut) throw new Error('Request timed out. Reload to check campaign progress before retrying.');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw Object.assign(new Error(typeof data?.detail === 'string' ? data.detail : 'Request failed. Please try again.'), { status: response.status });
  }
  return response;
}
const jsonRequest = async (path, options) => (await request(path, options)).json();
const jsonBody = value => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), method: 'POST' });
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Stopped observing', 'AbortError')); return; }
  const abort = () => { clearTimeout(timer); reject(new DOMException('Stopped observing', 'AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

export async function hashFile(file) {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += 262144) {
    const bytes = new Uint8Array(await file.slice(offset, offset + 262144).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    hash.update(binary);
  }
  return hash.digest().toHex();
}

export async function observeCampaign(id, { signal, onEvent }) {
  let after = 0;
  let failures = 0;
  while (true) {
    try {
      const job = await jsonRequest(`/v1/campaigns/${id}`, { signal });
      let rows;
      do {
        rows = await jsonRequest(`/v1/campaigns/${id}/recipients?after=${after}&limit=250`, { signal });
        let consumed = 0;
        for (const row of rows) {
          if (!['accepted', 'permanently_failed', 'unknown'].includes(row.state)) break;
          onEvent({ type: 'progress', message: `${row.email}: ${row.state === 'accepted' ? 'sent (accepted by Gmail)' : row.state}` });
          after = row.row_no;
          consumed++;
        }
        if (consumed < rows.length) break;
      } while (rows.length === 250);
      failures = 0;
      if (['complete', 'cancelled', 'invalid', 'blocked', 'awaiting_auth'].includes(job.state)) {
        onEvent({ type: job.state === 'awaiting_auth' ? 'auth_error' : 'complete',
          message: `${job.state}: ${job.accepted} sent, ${job.failed} failed, ${job.unknown} unknown.${job.error ? ` ${job.error}` : ''}` });
        return job;
      }
      await pause(1000, signal);
    } catch (error) {
      if (error.name === 'AbortError' || error.status === 401 || error.status === 404) throw error;
      failures++;
      if (failures > 6) throw new Error('Progress connection interrupted. The campaign continues; reload to reconnect.');
      await pause(Math.min(30000, 1000 * 2 ** failures), signal);
    }
  }
}

export async function sendEmails(formData, { signal, batchId, onEvent, onCampaign = () => {} }) {
  const file = formData.get('csv_file');
  const reservation = await jsonRequest('/v1/uploads', { ...jsonBody({ size: file.size, sha256: await hashFile(file) }), signal });
  if (reservation.method === 'PUT') {
    await request(reservation.url, { method: 'PUT', body: file, signal });
  } else {
    const body = new FormData();
    Object.entries(reservation.fields).forEach(([key, value]) => body.append(key, value));
    body.append('file', file);
    const response = await fetch(reservation.url, { method: 'POST', body, signal });
    if (!response.ok) throw new Error('Object upload failed. Please try again.');
  }
  await jsonRequest(`/v1/uploads/${reservation.id}/complete`, { method: 'POST', signal });
  // Once creation starts, receive its durable ID before processing a cancellation.
  const job = await jsonRequest('/v1/campaigns', {
    ...jsonBody({ upload_id: reservation.id, subject: formData.get('email_subject'), body: formData.get('email_body'), is_html: formData.get('isHtml') === 'true' }),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': batchId },
  });
  await onCampaign(job.id);
  if (signal?.aborted) {
    throw new DOMException('Cancelled', 'AbortError');
  }
  if (['cancelled', 'blocked'].includes(job.state)) await request(`/v1/campaigns/${job.id}/retry`, { method: 'POST', signal });
  return observeCampaign(job.id, { signal, onEvent });
}

export const cancelCampaign = id => request(`/v1/campaigns/${id}/cancel`, { method: 'POST' });
export const listCampaigns = () => jsonRequest('/v1/campaigns');
export async function downloadCampaignLogs(id) {
  const response = await request(`/v1/campaigns/${id}/logs`);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'email_logs.csv';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
