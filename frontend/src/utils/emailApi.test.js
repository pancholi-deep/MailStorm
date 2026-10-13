import { observeCampaign, request, cancelCampaign, hashFile, sendEmails } from './emailApi';
import { saveSession } from './session';

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  saveSession({ user: { email: 'alice@gmail.com' }, access_token: 'app-session' });
  global.fetch = jest.fn();
});
afterEach(() => { delete global.fetch; });
const response = value => ({ ok: true, json: async () => value });

test('observes durable results and completion without resending messages', async () => {
  fetch.mockResolvedValueOnce(response({ state: 'complete', accepted: 1, failed: 0, unknown: 0 }))
    .mockResolvedValueOnce(response([{ row_no: 1, state: 'accepted', email: 'a@example.org' }]));
  const onEvent = jest.fn();
  await observeCampaign('job', { onEvent });
  expect(onEvent.mock.calls[0][0].message).toContain('accepted by Gmail');
  expect(onEvent.mock.calls[1][0].type).toBe('complete');
  expect(fetch.mock.calls.every(([, options]) => !options.method)).toBe(true);
});

test('explicit cancellation reaches the server', async () => {
  fetch.mockResolvedValue(response({ state: 'cancelled' }));
  await cancelCampaign('job');
  expect(fetch.mock.calls[0][0]).toMatch('/v1/campaigns/job/cancel');
  expect(fetch.mock.calls[0][1].method).toBe('POST');
});

test('expired sessions never send a Bearer null request', async () => {
  sessionStorage.clear();
  await expect(request('/v1/campaigns')).rejects.toMatchObject({ status: 401 });
  expect(fetch).not.toHaveBeenCalled();
});

test('maps backend validation failures to readable errors', async () => {
  fetch.mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'CSV row requires email' }) });
  await expect(request('/v1/campaigns')).rejects.toThrow('CSV row requires email');
});

test('hashes files in bounded chunks against a known digest', async () => {
  const file = { size: 3, slice: () => ({ arrayBuffer: async () => new TextEncoder().encode('abc').buffer }) };
  expect(await hashFile(file)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('uploads, finalizes, and submits idempotently before observing', async () => {
  const file = { size: 3, slice: () => ({ arrayBuffer: async () => new TextEncoder().encode('abc').buffer }) };
  const form = { get: key => ({ csv_file: file, email_subject: 'Hi', email_body: 'Body', isHtml: 'true' }[key]) };
  fetch.mockResolvedValueOnce(response({ id: 'upload', method: 'PUT', url: '/v1/uploads/upload/content' }))
    .mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({}))
    .mockResolvedValueOnce(response({ id: 'job', state: 'importing' }))
    .mockResolvedValueOnce(response({ state: 'complete', accepted: 1, failed: 0, unknown: 0 }))
    .mockResolvedValueOnce(response([]));
  const onCampaign = jest.fn();
  await sendEmails(form, { batchId: 'key', onEvent: jest.fn(), onCampaign });
  expect(onCampaign).toHaveBeenCalledWith('job');
  expect(fetch.mock.calls[3][1].headers['Idempotency-Key']).toBe('key');
  expect(JSON.parse(fetch.mock.calls[3][1].body).is_html).toBe(true);
});
