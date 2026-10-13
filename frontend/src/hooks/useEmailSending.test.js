import { act, renderHook, waitFor } from '@testing-library/react';
import useEmailSending from './useEmailSending';
import { sendEmails, listCampaigns } from '../utils/emailApi';
import { validateCSVContent } from '../utils/validationUtils';
import { getBatchIdentity } from '../utils/batchUtils';

jest.mock('../utils/emailApi', () => ({
  sendEmails: jest.fn(),
  listCampaigns: jest.fn(),
  cancelCampaign: jest.fn(),
  observeCampaign: jest.fn(),
  downloadCampaignLogs: jest.fn(),
}));
jest.mock('../utils/validationUtils', () => ({ validateCSVContent: jest.fn() }));
jest.mock('../utils/batchUtils', () => ({ getBatchIdentity: jest.fn(), forgetBatch: jest.fn() }));

const input = () => ({
  csvFile: new File(['name,email\nAlice,a@gmail.com'], 'list.csv'),
  subject: 'Hi',
  body: 'Body',
  isHtml: false,
  userEmail: 'sender@gmail.com',
});

beforeEach(() => {
  listCampaigns.mockResolvedValue([]);
  validateCSVContent.mockResolvedValue([]);
  getBatchIdentity.mockResolvedValue({ id: 'batch-id', fingerprint: 'hash' });
});

test('cancel keeps Send locked until the original request settles', async () => {
  let rejectSend;
  sendEmails.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        rejectSend = reject;
      })
  );
  const { result } = renderHook(() => useEmailSending(jest.fn()));
  const values = input();
  let first;
  await act(async () => {
    first = result.current.send(values);
  });
  await waitFor(() => expect(sendEmails).toHaveBeenCalledTimes(1));
  await act(async () => result.current.cancel());
  expect(sendEmails.mock.calls[0][1].signal.aborted).toBe(true);
  expect(result.current.sending).toBe(true);
  await act(async () => result.current.send(values));
  expect(sendEmails).toHaveBeenCalledTimes(1);
  await act(async () => {
    rejectSend(new DOMException('Cancelled', 'AbortError'));
    await first;
  });
  expect(result.current.sending).toBe(false);
  expect(result.current.logs.join(' ')).toMatch(/Cancellation requested/);
});

test('retry reuses the batch identity and preserves readable progress logs', async () => {
  sendEmails.mockImplementation(async (data, { onEvent }) => {
    onEvent({ type: 'complete', message: 'Finished' });
  });
  const { result } = renderHook(() => useEmailSending(jest.fn()));
  const values = input();
  await act(async () => result.current.send(values));
  await act(async () => result.current.send(values));
  expect(getBatchIdentity).toHaveBeenCalledTimes(1);
  expect(sendEmails.mock.calls.map(([, options]) => options.batchId)).toEqual([
    'batch-id',
    'batch-id',
  ]);
  expect(result.current.logs).toEqual(['Finished']);
});

test('unmount aborts an active send', async () => {
  let rejectSend;
  sendEmails.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        rejectSend = reject;
      })
  );
  const { result, unmount } = renderHook(() => useEmailSending(jest.fn()));
  let pending;
  await act(async () => {
    pending = result.current.send(input());
  });
  await waitFor(() => expect(sendEmails).toHaveBeenCalledTimes(1));
  unmount();
  expect(sendEmails.mock.calls[0][1].signal.aborted).toBe(true);
  rejectSend(new DOMException('Cancelled', 'AbortError'));
  await pending;
});

test('expired authentication clears the session after the request settles', async () => {
  const logout = jest.fn();
  sendEmails.mockRejectedValue(Object.assign(new Error('Expired'), { status: 401 }));
  const { result } = renderHook(() => useEmailSending(logout));
  await act(async () => result.current.send(input()));
  expect(logout).toHaveBeenCalledTimes(1);
  expect(result.current.sending).toBe(false);
});

test('reconnects after reload, bounds logs, and does not cancel on unmount', async () => {
  const { observeCampaign, cancelCampaign } = require('../utils/emailApi');
  listCampaigns.mockResolvedValue([{ id: 'existing-job', state: 'running' }]);
  let finish;
  observeCampaign.mockImplementation((id, { onEvent }) => {
    for (let i = 0; i < 700; i++) onEvent({ type: 'progress', message: `row ${i}` });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const { result, unmount } = renderHook(() => useEmailSending(jest.fn()));
  await waitFor(() => expect(result.current.sending).toBe(true));
  expect(result.current.logs).toHaveLength(500);
  expect(result.current.logs[499]).toBe('row 699');
  unmount();
  expect(cancelCampaign).not.toHaveBeenCalled();
  finish();
});
