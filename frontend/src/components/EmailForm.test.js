import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EmailForm from './EmailForm';
import { AuthContext } from '../context/authContext';
import { sendEmails, listCampaigns } from '../utils/emailApi';
import { getBatchIdentity } from '../utils/batchUtils';

jest.mock('../utils/emailApi', () => ({ sendEmails: jest.fn(), listCampaigns: jest.fn(async () => []), cancelCampaign: jest.fn(), observeCampaign: jest.fn(), downloadCampaignLogs: jest.fn() }));
jest.mock('../utils/campaignLibraryApi', () => ({ listSavedCampaigns: jest.fn(async () => []) }));
jest.mock('../utils/batchUtils', () => ({ getBatchIdentity: jest.fn(), forgetBatch: jest.fn() }));

beforeEach(() => {
  listCampaigns.mockResolvedValue([]);
  require('../utils/campaignLibraryApi').listSavedCampaigns.mockResolvedValue([]);
  getBatchIdentity.mockResolvedValue({ id: 'batch', fingerprint: 'hash' });
  sendEmails.mockImplementation(async (data, { onEvent }) => onEvent({ type: 'complete', message: 'Finished sending emails.' }));
});

function renderForm() {
  render(<MemoryRouter><AuthContext.Provider value={{ user: { name: 'Sender', email: 'sender@gmail.com' }, logout: jest.fn() }}><EmailForm /></AuthContext.Provider></MemoryRouter>);
}

function uploadCSV() {
  fireEvent.change(screen.getByLabelText('Upload CSV', { selector: 'input' }), { target: { files: [new File(['name,email\nAlice,a@example.org'], 'list.csv')] } });
}

async function processTemplate(name, text) {
  uploadCSV();
  fireEvent.click(screen.getByRole('button', { name: 'Import template' }));
  fireEvent.change(screen.getByLabelText('Upload Template', { selector: 'input' }), { target: { files: [new File([text], name)] } });
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
  fireEvent.click(screen.getByRole('button', { name: 'Send Emails' }));
  await waitFor(() => expect(sendEmails).toHaveBeenCalledTimes(1));
  expect(sendEmails.mock.calls[0][0].get('isHtml')).toBe('false');
  expect(screen.getByRole('log')).toHaveTextContent('Finished sending emails.');
});

test('manual composition retains the existing controls and validates CSV before sending', async () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Upload CSV', { selector: 'input' }), { target: { files: [new File(['name,email\nAlice,broken'], 'bad.csv')] } });
  fireEvent.change(screen.getByLabelText('Email Subject'), { target: { value: 'Hi' } });
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'Body' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send Emails' }));
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('invalid email address'));
  expect(sendEmails).not.toHaveBeenCalled();
});

test('imports a template without a CSV and protects existing message edits', async () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Email Subject'), { target: { value: 'My subject' } });
  fireEvent.change(screen.getByLabelText('Email Body'), { target: { value: 'My draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import template' }));
  fireEvent.change(screen.getByLabelText('Upload Template'), { target: { files: [new File(['<!-- Subject: Imported --><p>Hello {name}</p>'], 'message.html')] } });
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  expect(screen.getByLabelText('Email Body')).toHaveValue('My draft');
  window.confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  await waitFor(() => expect(screen.getByLabelText('Email Subject')).toHaveValue('Imported'));
  expect(screen.getByLabelText('Email body contains HTML')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Import template' })).toHaveAttribute('aria-expanded', 'false');
});
