import { request, jsonRequest, jsonBody } from './httpClient';
import { downloadBlob } from './download';
import { uploadContacts } from './uploadApi';

const pause = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Stopped observing', 'AbortError'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Stopped observing', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });

export async function observeCampaign(id, { signal, onEvent }) {
  let after = 0;
  let failures = 0;
  while (true) {
    try {
      const job = await jsonRequest(`/v1/campaigns/${id}`, { signal });
      let rows;
      do {
        rows = await jsonRequest(`/v1/campaigns/${id}/recipients?after=${after}&limit=250`, {
          signal,
        });
        let consumed = 0;
        for (const row of rows) {
          if (!['accepted', 'permanently_failed', 'unknown'].includes(row.state)) break;
          onEvent({
            type: 'progress',
            message: `${row.email}: ${row.state === 'accepted' ? 'sent (accepted by Gmail)' : row.state}`,
          });
          after = row.row_no;
          consumed++;
        }
        if (consumed < rows.length) break;
      } while (rows.length === 250);
      failures = 0;
      if (['complete', 'cancelled', 'invalid', 'blocked', 'awaiting_auth'].includes(job.state)) {
        onEvent({
          type: job.state === 'awaiting_auth' ? 'auth_error' : 'complete',
          message: `${job.state}: ${job.accepted} sent, ${job.failed} failed, ${job.unknown} unknown.${job.error ? ` ${job.error}` : ''}`,
        });
        return job;
      }
      await pause(1000, signal);
    } catch (error) {
      if (error.name === 'AbortError' || error.status === 401 || error.status === 404) throw error;
      failures++;
      if (failures > 6)
        throw new Error(
          'Progress connection interrupted. The campaign continues; reload to reconnect.'
        );
      await pause(Math.min(30000, 1000 * 2 ** failures), signal);
    }
  }
}

export async function sendEmails(formData, { signal, batchId, onEvent, onCampaign = () => {} }) {
  const uploadId =
    formData.get('upload_id') || (await uploadContacts(formData.get('csv_file'), signal));
  // Once creation starts, receive its durable ID before processing a cancellation.
  const job = await jsonRequest('/v1/campaigns', {
    ...jsonBody({
      upload_id: uploadId,
      subject: formData.get('email_subject'),
      body: formData.get('email_body'),
      is_html: formData.get('isHtml') === 'true',
      ...(formData.get('field_mapping')
        ? { field_mapping: JSON.parse(formData.get('field_mapping')) }
        : {}),
    }),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': batchId },
  });
  await onCampaign(job.id);
  if (signal?.aborted) {
    throw new DOMException('Cancelled', 'AbortError');
  }
  if (['cancelled', 'blocked'].includes(job.state))
    await request(`/v1/campaigns/${job.id}/retry`, { method: 'POST', signal });
  return observeCampaign(job.id, { signal, onEvent });
}

export const cancelCampaign = (id) => request(`/v1/campaigns/${id}/cancel`, { method: 'POST' });
export const listCampaigns = () => jsonRequest('/v1/campaigns');
export async function downloadCampaignLogs(id) {
  const response = await request(`/v1/campaigns/${id}/logs`);
  downloadBlob(await response.blob(), 'email_logs.csv');
}
