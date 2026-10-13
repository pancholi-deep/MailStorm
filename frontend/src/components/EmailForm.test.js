import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EmailForm from './EmailForm';
import { AuthContext } from '../context/authContext';
import { sendEmails, listCampaigns } from '../utils/emailApi';
import { getBatchIdentity } from '../utils/batchUtils';

jest.mock('../utils/gmailApi', () => ({
  getGmailStatus: jest.fn(async () => ({ connected: true, revocation_pending: false })),
  disconnectGmail: jest.fn(),
}));

jest.mock('../utils/emailApi', () => ({
  sendEmails: jest.fn(),
  listCampaigns: jest.fn(async () => []),
  cancelCampaign: jest.fn(),
  observeCampaign: jest.fn(),
  downloadCampaignLogs: jest.fn(),
}));
jest.mock('../utils/campaignLibraryApi', () => ({ listSavedCampaigns: jest.fn(async () => []) }));
jest.mock('../utils/batchUtils', () => ({ getBatchIdentity: jest.fn(), forgetBatch: jest.fn() }));

beforeEach(() => {
  require('../utils/gmailApi').getGmailStatus.mockResolvedValue({
    connected: true,
    revocation_pending: false,
  });
  listCampaigns.mockResolvedValue([]);
  require('../utils/campaignLibraryApi').listSavedCampaigns.mockResolvedValue([]);
  getBatchIdentity.mockResolvedValue({ id: 'batch', fingerprint: 'hash' });
  sendEmails.mockImplementation(async (data, { onEvent }) =>
    onEvent({ type: 'complete', message: 'Finished sending emails.' })
  );
});

function renderForm() {
  render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{ user: { name: 'Sender', email: 'sender@gmail.com' }, logout: jest.fn() }}
      >
        <EmailForm />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

function uploadCSV() {
  fireEvent.change(screen.getByLabelText('Upload CSV', { selector: 'input' }), {
    target: { files: [new File(['name,email\nAlice,a@example.org'], 'list.csv')] },
  });
}

async function processTemplate(name, text) {
  uploadCSV();
  fireEvent.click(screen.getByRole('button', { name: 'Import template' }));
  fireEvent.change(screen.getByLabelText('Upload Template', { selector: 'input' }), {
    target: { files: [new File([text], name)] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  await waitFor(() => expect(screen.getByLabelText('Email Subject')).toHaveValue('Hi'));
}

test('HTML followed by Reset and TXT preserves the current workflow and sends plain text', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderForm();
  await processTemplate('message.html', '<!-- Subject: Hi --><p>Hello {name}</p>');
  expect(screen.getByLabelText('Email Subject')).toHaveValue('Hi');
  expect(screen.getByLabelText('Email Body')).toHaveValue('<p>Hello {name}</p>');
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  await processTemplate('message.txt', 'Subject: Hi\nBody: Inline text\nNext line');
  expect(screen.getByLabelText('Email Body')).toHaveValue('Inline text\nNext line');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send Emails' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send Emails' }));
  await waitFor(() => expect(sendEmails).toHaveBeenCalledTimes(1));
  expect(sendEmails.mock.calls[0][0].get('isHtml')).toBe('false');
  expect(screen.getByRole('log')).toHaveTextContent('Finished sending emails.');
});

test('manual composition retains the existing controls and validates CSV before sending', async () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Upload CSV', { selector: 'input' }), {
    target: { files: [new File(['name,email\nAlice,broken'], 'bad.csv')] },
  });
  fireEvent.change(screen.getByLabelText('Email Subject'), { target: { value: 'Hi' } });
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'Body' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send Emails' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send Emails' }));
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('invalid email address'));
  expect(sendEmails).not.toHaveBeenCalled();
});

test('imports a template without a CSV and protects existing message edits', async () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Email Subject'), { target: { value: 'My subject' } });
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'My draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import template' }));
  fireEvent.change(screen.getByLabelText('Upload Template'), {
    target: {
      files: [new File(['<!-- Subject: Imported --><p>Hello {name}</p>'], 'message.html')],
    },
  });
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  expect(screen.getByLabelText('Email Body')).toHaveValue('My draft');
  window.confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  await waitFor(() => expect(screen.getByLabelText('Email Subject')).toHaveValue('Imported'));
  expect(screen.getByLabelText('Email body contains HTML')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Import template' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
});

test('disconnect cancels sending access while keeping the current draft editable', async () => {
  const gmailApi = require('../utils/gmailApi');
  gmailApi.disconnectGmail.mockResolvedValue({ connected: false, revocation_pending: false });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderForm();
  fireEvent.change(screen.getByLabelText('Email Subject'), {
    target: { value: 'Keep my subject' },
  });
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'Keep my draft' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Disconnect Gmail' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Gmail' }));
  expect(await screen.findByText(/Gmail is disconnected/)).toBeInTheDocument();
  expect(screen.getByLabelText('Email Subject')).toHaveValue('Keep my subject');
  expect(screen.getByLabelText('Email Body')).toHaveValue('Keep my draft');
  expect(screen.getByLabelText('Email Body')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Send Emails' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reconnect Gmail' })).toBeEnabled();
  expect(gmailApi.disconnectGmail).toHaveBeenCalledTimes(1);
});

test('declining disconnect leaves Gmail connected', async () => {
  const gmailApi = require('../utils/gmailApi');
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  renderForm();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Disconnect Gmail' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Gmail' }));
  expect(gmailApi.disconnectGmail).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Send Emails' })).toBeEnabled();
});

test('unconfirmed revocation directs users to Google and survives page load', async () => {
  require('../utils/gmailApi').getGmailStatus.mockResolvedValue({
    connected: false,
    revocation_pending: true,
  });
  renderForm();
  expect(await screen.findByRole('link', { name: /Remove MailStorm access/ })).toHaveAttribute(
    'href',
    'https://myaccount.google.com/connections'
  );
  expect(screen.getByRole('button', { name: 'Send Emails' })).toBeDisabled();
});

test('lost disconnect response rechecks the server before allowing another send', async () => {
  const gmailApi = require('../utils/gmailApi');
  gmailApi.getGmailStatus
    .mockResolvedValueOnce({ connected: true })
    .mockResolvedValue({ connected: false });
  gmailApi.disconnectGmail.mockRejectedValue(new Error('Connection lost'));
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderForm();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Disconnect Gmail' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Gmail' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
  expect(screen.getByRole('button', { name: 'Send Emails' })).toBeDisabled();
  expect(screen.getByLabelText('Email Body')).toBeEnabled();
});

test('reconnect protects unsaved editor changes', async () => {
  require('../utils/gmailApi').getGmailStatus.mockResolvedValue({ connected: false });
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  renderForm();
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'Unsaved draft' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Reconnect Gmail' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect Gmail' }));
  expect(window.confirm).toHaveBeenCalledWith(
    expect.stringContaining('Unsaved edits will be lost')
  );
  expect(screen.getByLabelText('Email Body')).toHaveValue('Unsaved draft');
});
