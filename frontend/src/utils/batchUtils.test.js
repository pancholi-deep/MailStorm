import { webcrypto } from 'crypto';
import { forgetBatch, getBatchIdentity } from './batchUtils';

beforeEach(() => {
  sessionStorage.clear();
  global.crypto = webcrypto;
});

const file = text => ({ size: text.length, slice: (start, end) => ({ arrayBuffer: async () => new TextEncoder().encode(text.slice(start, end)).buffer }) });

test('identical files and message content reuse the batch after reauthentication', async () => {
  const first = await getBatchIdentity(file('name,email\nAlice,a@gmail.com'), 'message:alice@gmail.com');
  const retry = await getBatchIdentity(file('name,email\nAlice,a@gmail.com'), 'message:alice@gmail.com');
  expect(retry.id).toBe(first.id);
  expect(sessionStorage.getItem('mailstorm_batches')).not.toContain('alice@gmail.com');
  expect(sessionStorage.getItem('mailstorm_batches')).not.toContain('Alice');
});

test('changed content or an explicit reset creates a new batch', async () => {
  const first = await getBatchIdentity(file('same'), 'original');
  const changed = await getBatchIdentity(file('same'), 'changed');
  expect(changed.id).not.toBe(first.id);
  forgetBatch(first.fingerprint);
  expect((await getBatchIdentity(file('same'), 'original')).id).not.toBe(first.id);
});
