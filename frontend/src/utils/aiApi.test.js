import { generateEmailSuggestion, reviewSavedCampaign } from './aiApi';
import { request } from './httpClient';
import { saveSession } from './session';

beforeEach(() => {
  jest.useFakeTimers();
  saveSession({ user: { email: 'test@example.org' }, access_token: 'test-session' });
  global.fetch = jest.fn(
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
  );
});

afterEach(() => {
  jest.useRealTimers();
  sessionStorage.clear();
  delete global.fetch;
});

test('AI has room for the backend deadline and reports its own timeout', async () => {
  const pending = generateEmailSuggestion({ action: 'draft' });
  const rejected = expect(pending).rejects.toThrow('AI took too long to respond.');
  jest.advanceTimersByTime(65000);
  const options = fetch.mock.calls[0][1];
  expect(options.signal.aborted).toBe(false);
  expect(options).not.toHaveProperty('timeoutMs');
  jest.advanceTimersByTime(10000);
  await rejected;
});

test('other requests retain their original timeout', async () => {
  const pending = request('/v1/campaigns');
  const rejected = expect(pending).rejects.toThrow('Request timed out.');
  jest.advanceTimersByTime(45000);
  await rejected;
});

test('user cancellation remains immediate during a longer AI request', async () => {
  const controller = new AbortController();
  const pending = generateEmailSuggestion({}, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
});

test('specific backend diagnostics reach the UI unchanged', async () => {
  fetch.mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({ detail: 'Google denied this AI request.', code: 'ai_access_denied' }),
  });
  await expect(generateEmailSuggestion({})).rejects.toThrow('Google denied this AI request.');
});

test('review sends only saved identity and consent, with a bounded background timeout', async () => {
  const pending = reviewSavedCampaign({
    id: 'campaign',
    revision: 2,
    body: 'Private local copy',
    contacts: ['never share'],
  });
  const rejected = expect(pending).rejects.toThrow('Request timed out.');
  const options = fetch.mock.calls[0][1];
  expect(JSON.parse(options.body)).toEqual({ campaign_id: 'campaign', revision: 2, consent: true });
  jest.advanceTimersByTime(30000);
  expect(options.signal.aborted).toBe(false);
  jest.advanceTimersByTime(10000);
  await rejected;
});
