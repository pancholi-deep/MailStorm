import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EmailForm from './EmailForm';
import { AuthContext } from '../context/authContext';
import * as api from '../utils/campaignLibraryApi';
import { sendEmails, listCampaigns } from '../utils/emailApi';
import { uploadContacts, inspectUploadedContacts } from '../utils/uploadApi';
import { getUploadBatchIdentity } from '../utils/batchUtils';

jest.mock('../utils/gmailApi', () => ({
  getGmailStatus: jest.fn(async () => ({ connected: true, revocation_pending: false })),
  disconnectGmail: jest.fn(),
}));
jest.mock('../utils/aiApi', () => ({
  reviewSavedCampaign: jest.fn(),
  getAiStatus: jest.fn(async () => ({ available: true })),
  generateEmailSuggestion: jest.fn(async () => ({
    subject: 'An update',
    body: '<h1>Hello {name}</h1><p>An update.</p>',
    is_html: true,
  })),
}));
jest.mock('../utils/uploadApi', () => ({
  uploadContacts: jest.fn(),
  inspectUploadedContacts: jest.fn(),
}));
jest.mock('../utils/campaignLibraryApi', () => ({
  listSavedCampaigns: jest.fn(),
  loadSavedCampaign: jest.fn(),
  createSavedCampaign: jest.fn(),
  overwriteSavedCampaign: jest.fn(),
  deleteSavedCampaign: jest.fn(),
}));
jest.mock('../utils/emailApi', () => ({
  sendEmails: jest.fn(),
  listCampaigns: jest.fn(),
  cancelCampaign: jest.fn(),
  observeCampaign: jest.fn(),
  downloadCampaignLogs: jest.fn(),
}));
jest.mock('../utils/batchUtils', () => ({
  getBatchIdentity: jest.fn(),
  getUploadBatchIdentity: jest.fn(),
  forgetBatch: jest.fn(),
  rememberReusableSend: jest.fn(),
  finishReusableSend: jest.fn(),
}));
const sales = {
  id: 'sales',
  name: 'Sales pitch',
  filename: 'sales.csv',
  upload_id: 'stored-contacts',
  subject: 'Hello {name}',
  body: '<p>Sales pitch</p>',
  is_html: true,
  revision: 1,
  recipient_count: 2,
};

beforeEach(() => {
  require('../utils/aiApi').getAiStatus.mockResolvedValue({ available: true });
  require('../utils/aiApi').generateEmailSuggestion.mockResolvedValue({
    subject: 'An update',
    body: '<h1>Hello {name}</h1><p>An update.</p>',
    is_html: true,
  });
  require('../utils/gmailApi').getGmailStatus.mockResolvedValue({
    connected: true,
    revocation_pending: false,
  });
  listCampaigns.mockResolvedValue([]);
  api.listSavedCampaigns.mockResolvedValue([sales]);
  api.loadSavedCampaign.mockResolvedValue(sales);
  uploadContacts.mockResolvedValue('new-contacts');
  inspectUploadedContacts.mockResolvedValue({
    columns: ['name', 'email'],
    sample: { name: 'Alice Smith', email: 'a@example.org' },
    recipient_count: 2,
  });
  getUploadBatchIdentity.mockReturnValue({ id: 'send-key', fingerprint: 'send-hash' });
  sendEmails.mockImplementation(async (data, { onEvent }) => {
    onEvent({ type: 'complete', message: 'Finished' });
    return { state: 'complete' };
  });
  api.overwriteSavedCampaign.mockImplementation(async (id, data) => ({
    ...data,
    id,
    revision: data.revision + 1,
    recipient_count: 2,
  }));
  api.createSavedCampaign.mockImplementation(async (data) => ({
    ...data,
    id: 'copy',
    revision: 1,
    recipient_count: 2,
  }));
  global.crypto = { randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001') };
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => jest.restoreAllMocks());
function renderForm() {
  return render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{ user: { name: 'Sender', email: 'sender@gmail.com' }, logout: jest.fn() }}
      >
        <EmailForm />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
async function openSales() {
  fireEvent.click(await screen.findByRole('button', { name: 'Sales pitch 2 contacts' }));
  await screen.findByDisplayValue('<p>Sales pitch</p>');
  await screen.findByRole('button', { name: 'Insert {name}' });
}

test('saving shows the server review and edits require a fresh check', async () => {
  api.overwriteSavedCampaign.mockImplementation(async (id, data) => ({
    ...data,
    id,
    revision: data.revision + 1,
    recipient_count: 2,
    content_review: { score: 0, level: 'low', findings: [] },
  }));
  renderForm();
  await openSales();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('0%');
  fireEvent.change(screen.getByLabelText('Email Subject'), { target: { value: 'A new subject' } });
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
  expect(screen.getByText(/Draft changed. Save again/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('0%');
  expect(screen.queryByText(/Draft changed. Save again/)).not.toBeInTheDocument();
  expect(sendEmails).not.toHaveBeenCalled();
});

test('save completes and editor stays available while the consented AI review is pending', async () => {
  const reviewSavedCampaign = require('../utils/aiApi').reviewSavedCampaign;
  reviewSavedCampaign.mockImplementation(() => new Promise(() => {}));
  const content_review = { score: 0, level: 'low', findings: [] };
  api.loadSavedCampaign.mockResolvedValue({ ...sales, content_review });
  api.overwriteSavedCampaign.mockImplementation(async (id, data) => ({
    ...data,
    id,
    revision: data.revision + 1,
    recipient_count: 2,
    content_review,
  }));
  renderForm();
  await openSales();
  fireEvent.click(screen.getByLabelText(/Use Gemini to review this saved draft/));
  expect(reviewSavedCampaign).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Email Subject'), {
    target: { value: 'An updated subject' },
  });
  expect(reviewSavedCampaign.mock.calls[0][1].aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Campaign saved.');
  await screen.findByText(/Gemini is reviewing/);
  expect(screen.getByLabelText('Email Body')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  expect(reviewSavedCampaign.mock.calls[1][0].revision).toBe(2);
  expect(sendEmails).not.toHaveBeenCalled();
});

test('applying an HTML suggestion switches the editor format without saving or sending', async () => {
  renderForm();
  await openSales();
  fireEvent.click(screen.getByLabelText('Email body contains HTML'));
  expect(screen.getByLabelText('Email body contains HTML')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'AI Assist' }));
  await screen.findByLabelText('Writing task');
  fireEvent.change(screen.getByLabelText('Writing task'), { target: { value: 'draft' } });
  fireEvent.change(screen.getByLabelText(/What should the email say/), {
    target: { value: 'Write a product update for {name}.' },
  });
  fireEvent.click(screen.getByLabelText(/I’m only sharing nonconfidential/));
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Apply to draft' }));
  expect(screen.getByLabelText('Email body contains HTML')).toBeChecked();
  expect(screen.getByLabelText('Email Body')).toHaveValue('<h1>Hello {name}</h1><p>An update.</p>');
  expect(api.overwriteSavedCampaign).not.toHaveBeenCalled();
  expect(sendEmails).not.toHaveBeenCalled();
});

test('reopens saved content and sends edits without reuploading or autosaving', async () => {
  renderForm();
  await openSales();
  expect(screen.getByLabelText('Email body contains HTML')).toBeChecked();
  fireEvent.change(screen.getByLabelText('Email Body'), {
    target: { value: '<p>A revised pitch</p>' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send Emails' }));
  await waitFor(() => expect(sendEmails).toHaveBeenCalledTimes(1));
  const data = sendEmails.mock.calls[0][0];
  expect(data.uploadId).toBe('stored-contacts');
  expect(data.body).toBe('<p>A revised pitch</p>');
  expect(data.isHtml).toBe(true);
  expect(uploadContacts).not.toHaveBeenCalled();
  expect(api.overwriteSavedCampaign).not.toHaveBeenCalled();
});

test('overwrites the current campaign, then creates an independent copy', async () => {
  renderForm();
  await openSales();
  fireEvent.change(screen.getByLabelText('Email Subject'), { target: { value: 'Revised pitch' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Campaign saved.');
  expect(api.overwriteSavedCampaign).toHaveBeenCalledWith(
    'sales',
    expect.objectContaining({ subject: 'Revised pitch', revision: 1, upload_id: 'stored-contacts' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save as new copy' }));
  await screen.findByText('New campaign copy saved.');
  expect(api.createSavedCampaign).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Sales pitch (copy)',
      subject: 'Revised pitch',
      upload_id: 'stored-contacts',
    })
  );
  expect(uploadContacts).not.toHaveBeenCalled();
});

test('creates a saved campaign from a new CSV and manual content without sending', async () => {
  renderForm();
  fireEvent.change(screen.getByLabelText(/Campaign name/), { target: { value: 'New sales' } });
  fireEvent.change(screen.getByLabelText('Upload CSV', { selector: 'input' }), {
    target: { files: [new File(['name,email\nAlice,a@example.org'], 'sales.csv')] },
  });
  fireEvent.change(screen.getByLabelText('Email Subject'), { target: { value: 'Hi' } });
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'Body' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }));
  await screen.findByText('Campaign saved.');
  expect(uploadContacts).toHaveBeenCalledTimes(1);
  expect(api.createSavedCampaign).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'New sales', upload_id: 'new-contacts', is_html: false })
  );
  expect(sendEmails).not.toHaveBeenCalled();
});

test('preserves edits on a stale overwrite and lets the user save a copy', async () => {
  renderForm();
  await openSales();
  api.overwriteSavedCampaign.mockRejectedValue(
    new Error('This campaign changed in another tab. Reopen it or save your edits as a new copy.')
  );
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'My edits' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('another tab');
  expect(screen.getByLabelText('Email Body')).toHaveValue('My edits');
  fireEvent.click(screen.getByRole('button', { name: 'Save as new copy' }));
  await screen.findByText('New campaign copy saved.');
  expect(api.createSavedCampaign).toHaveBeenCalledWith(
    expect.objectContaining({ body: 'My edits' })
  );
});

test('replaces contacts and preserves the selected campaign identity', async () => {
  renderForm();
  await openSales();
  fireEvent.change(screen.getByLabelText('Replace contact CSV (optional)', { selector: 'input' }), {
    target: { files: [new File(['name,email\nBob,b@example.org'], 'new.csv')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Campaign saved.');
  expect(api.overwriteSavedCampaign).toHaveBeenCalledWith(
    'sales',
    expect.objectContaining({ upload_id: 'new-contacts', filename: 'new.csv' })
  );
});

test('guards unsaved edits when opening another campaign', async () => {
  renderForm();
  await openSales();
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'Keep this' } });
  window.confirm.mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Sales pitch 2 contacts' }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalled());
  expect(screen.getByLabelText('Email Body')).toHaveValue('Keep this');
  expect(api.loadSavedCampaign).toHaveBeenCalledTimes(1);
});

test('deletes a saved definition and clears the editor', async () => {
  renderForm();
  await openSales();
  api.deleteSavedCampaign.mockResolvedValue({ ok: true });
  fireEvent.click(screen.getByRole('button', { name: 'Delete campaign' }));
  await screen.findByText('Saved campaign deleted. Existing sends are unchanged.');
  expect(api.deleteSavedCampaign).toHaveBeenCalledWith('sales', 1);
  expect(screen.getByLabelText(/Campaign name/)).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Sales pitch 2 contacts' })).not.toBeInTheDocument();
});

test('filters the library and expands it with an accessible mobile control', async () => {
  renderForm();
  await screen.findByRole('button', { name: 'Sales pitch 2 contacts' });
  const browse = screen.getByRole('button', { name: 'Browse campaigns' });
  expect(browse).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(browse);
  expect(browse).toHaveAttribute('aria-expanded', 'true');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search campaigns' }), {
    target: { value: 'newsletter' },
  });
  expect(screen.getByText('No matching campaigns')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sales pitch 2 contacts' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'SALES' } });
  await openSales();
  expect(screen.getByRole('button', { name: 'Browse campaigns' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
});

test('new campaign and reset both protect unsaved work', async () => {
  renderForm();
  await openSales();
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'Keep this draft' } });
  window.confirm.mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: /New campaign/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(window.confirm).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('Email Body')).toHaveValue('Keep this draft');
  expect(screen.getByLabelText(/Campaign name/)).toHaveValue('Sales pitch');
});

test('deletes another campaign from the library without opening it or discarding current edits', async () => {
  api.listSavedCampaigns.mockResolvedValue([
    sales,
    { ...sales, id: 'newsletter', name: 'Newsletter', revision: 3 },
  ]);
  api.deleteSavedCampaign.mockResolvedValue({ ok: true });
  renderForm();
  await openSales();
  fireEvent.change(screen.getByLabelText('Email Body'), {
    target: { value: 'Keep my sales edits' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Delete campaign “Newsletter”' }));
  await screen.findByText('Saved campaign deleted. Existing sends are unchanged.');
  expect(api.deleteSavedCampaign).toHaveBeenCalledWith('newsletter', 3);
  expect(api.loadSavedCampaign).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Email Body')).toHaveValue('Keep my sales edits');
  expect(screen.getByLabelText(/Campaign name/)).toHaveValue('Sales pitch');
  expect(screen.queryByRole('button', { name: 'Newsletter 2 contacts' })).not.toBeInTheDocument();
});

test('confirms sidebar deletion and preserves the campaign and editor if deletion fails', async () => {
  renderForm();
  await openSales();
  fireEvent.change(screen.getByLabelText('Email Body'), {
    target: { value: 'Unsaved sales edits' },
  });
  window.confirm.mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Delete campaign “Sales pitch”' }));
  expect(api.deleteSavedCampaign).not.toHaveBeenCalled();
  expect(window.confirm).toHaveBeenCalledWith(
    expect.stringContaining('Unsaved edits will also be discarded.')
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Delete campaign “Sales pitch”' })).toBeEnabled()
  );
  window.confirm.mockReturnValue(true);
  api.deleteSavedCampaign.mockRejectedValue(new Error('Unable to delete campaign.'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete campaign “Sales pitch”' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to delete campaign.');
  expect(screen.getByLabelText('Email Body')).toHaveValue('Unsaved sales edits');
  expect(screen.getByRole('button', { name: 'Sales pitch 2 contacts' })).toBeInTheDocument();
});

test('a lost save response retains the uploaded contacts and create identity for retry', async () => {
  api.createSavedCampaign.mockRejectedValueOnce(new Error('Connection interrupted.'));
  renderForm();
  fireEvent.change(screen.getByLabelText(/Campaign name/), { target: { value: 'Retry campaign' } });
  fireEvent.change(screen.getByLabelText('Upload CSV', { selector: 'input' }), {
    target: { files: [new File(['name,email\nAlice,a@example.org'], 'sales.csv')] },
  });
  fireEvent.change(screen.getByLabelText('Email Subject'), { target: { value: 'Hi' } });
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'Keep this message' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted.');
  fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }));
  await screen.findByText('Campaign saved.');
  expect(uploadContacts).toHaveBeenCalledTimes(1);
  expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(api.createSavedCampaign.mock.calls[1][0]).toEqual(
    api.createSavedCampaign.mock.calls[0][0]
  );
  expect(screen.getByLabelText('Email Body')).toHaveValue('Keep this message');
});

test('restores mappings, marks mapping edits dirty, and saves them to overwrites and copies', async () => {
  api.loadSavedCampaign.mockResolvedValue({
    ...sales,
    body: '{company}',
    field_mapping: { company: 'business' },
  });
  inspectUploadedContacts.mockResolvedValue({
    columns: ['name', 'email', 'business', 'team'],
    sample: { name: 'Alice', email: 'a@example.org', business: 'Acme', team: 'Sales' },
    recipient_count: 2,
  });
  renderForm();
  fireEvent.click(await screen.findByRole('button', { name: 'Sales pitch 2 contacts' }));
  expect(await screen.findByLabelText('CSV column for {company}')).toHaveValue('business');
  expect(screen.getByText('Acme')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('CSV column for {company}'), {
    target: { value: 'team' },
  });
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Campaign saved.');
  expect(api.overwriteSavedCampaign).toHaveBeenCalledWith(
    'sales',
    expect.objectContaining({ field_mapping: { company: 'team' } })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save as new copy' }));
  await screen.findByText('New campaign copy saved.');
  expect(api.createSavedCampaign).toHaveBeenCalledWith(
    expect.objectContaining({ field_mapping: { company: 'team' } })
  );
});

test('an unmapped placeholder prevents campaign persistence', async () => {
  renderForm();
  await openSales();
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'Hi {missing}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Map these placeholders to CSV columns: missing');
  expect(api.overwriteSavedCampaign).not.toHaveBeenCalled();
});
