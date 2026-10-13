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
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid email address');
  expect(screen.getByRole('button', { name: 'Send Emails' })).toBeDisabled();
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

test('maps a custom placeholder, previews escaped HTML, and sends the mapping', async () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Upload CSV', { selector: 'input' }), {
    target: {
      files: [
        new File(['name,email,Company Name\nAlice Smith,a@example.org,<Acme & Co>'], 'sales.csv'),
      ],
    },
  });
  fireEvent.change(screen.getByLabelText('Email Subject'), { target: { value: 'Hi {name}' } });
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: '<p>{company}</p>' } });
  fireEvent.click(screen.getByLabelText('Email body contains HTML'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Map these placeholders');
  expect(screen.getByRole('button', { name: 'Send Emails' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('CSV column for {company}'), {
    target: { value: 'company name' },
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('<p>&lt;Acme &amp; Co&gt;</p>')).toBeInTheDocument();
  expect(screen.getByText('Hi Alice')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send Emails' }));
  await waitFor(() => expect(sendEmails).toHaveBeenCalledTimes(1));
  expect(JSON.parse(sendEmails.mock.calls[0][0].get('field_mapping'))).toEqual({
    company: 'company name',
  });
});

test('inserts a CSV field at the subject selection and revalidates a replacement CSV', async () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Upload CSV', { selector: 'input' }), {
    target: { files: [new File(['name,email,company\nAlice,a@example.org,Acme'], 'sales.csv')] },
  });
  const insert = await screen.findByRole('button', { name: 'Insert {company}' });
  const subject = screen.getByLabelText('Email Subject');
  fireEvent.change(subject, { target: { value: 'Hi TEAM!' } });
  fireEvent.focus(subject);
  subject.setSelectionRange(3, 7);
  fireEvent.click(insert);
  expect(subject).toHaveValue('Hi {company}!');
  fireEvent.change(screen.getByLabelText('Upload CSV', { selector: 'input' }), {
    target: { files: [new File(['name,email\nBob,b@example.org'], 'replacement.csv')] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('{company}');
  expect(screen.getByRole('button', { name: 'Send Emails' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Insert {company}' })).not.toBeInTheDocument();
});

test('Fields & preview is a workspace sidebar that can collapse and reopen from the editor', async () => {
  renderForm();
  const panel = screen.getByRole('complementary', { name: 'Fields & preview' });
  expect(panel.parentElement).toHaveClass('workspace-layout');
  const toggle = screen.getByRole('button', { name: 'Fields & preview' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(document.getElementById('fields-panel-content')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Open Fields & preview' }));
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById('fields-panel-content')).toBeVisible();
});
