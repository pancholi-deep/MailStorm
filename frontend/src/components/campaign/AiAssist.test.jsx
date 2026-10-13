import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AiAssist from './AiAssist';
import { generateEmailSuggestion, getAiStatus } from '../../utils/aiApi';

jest.mock('../../utils/aiApi', () => ({
  getAiStatus: jest.fn(),
  generateEmailSuggestion: jest.fn(),
}));
const props = {
  subject: 'Hi {name}',
  body: 'Hello {name}.',
  isHtml: false,
  fields: ['name'],
  disabled: false,
  onApply: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  getAiStatus.mockResolvedValue({ available: true });
  generateEmailSuggestion.mockResolvedValue({
    subject: 'Hello {name}',
    body: 'Greetings {name}.',
    is_html: false,
  });
});

async function ready() {
  await screen.findByLabelText('Writing task');
  fireEvent.click(screen.getByRole('checkbox'));
}

test('requires disclosure consent and explicit Apply; never applies automatically', async () => {
  render(<AiAssist {...props} />);
  await screen.findByLabelText('Writing task');
  expect(screen.getByRole('button', { name: 'Generate suggestion' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByRole('region', { name: 'AI suggestion' });
  expect(props.onApply).not.toHaveBeenCalled();
  expect(generateEmailSuggestion.mock.calls[0][0]).toEqual({
    action: 'proofread',
    tone: 'professional',
    brief: '',
    subject: props.subject,
    body: props.body,
    is_html: false,
    fields: [],
    consent: true,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  expect(props.onApply).toHaveBeenCalledWith(
    expect.objectContaining({ subject: 'Hello {name}', body: 'Greetings {name}.' })
  );
  expect(screen.queryByRole('region', { name: 'AI suggestion' })).not.toBeInTheDocument();
});

test('draft sends the brief and field names without existing copy or CSV values', async () => {
  generateEmailSuggestion.mockResolvedValue({
    subject: 'Welcome',
    body: '<h1>Welcome {name}</h1>',
    is_html: true,
  });
  render(<AiAssist {...props} />);
  await ready();
  fireEvent.change(screen.getByLabelText('Writing task'), { target: { value: 'draft' } });
  fireEvent.change(screen.getByLabelText(/What should the email say/), {
    target: { value: 'Welcome {name} to our newsletter' },
  });
  fireEvent.change(screen.getByLabelText('Tone'), { target: { value: 'friendly' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByRole('region', { name: 'AI suggestion' });
  expect(generateEmailSuggestion.mock.calls[0][0]).toEqual({
    action: 'draft',
    tone: 'friendly',
    brief: 'Welcome {name} to our newsletter',
    subject: '',
    body: '',
    is_html: true,
    fields: ['name'],
    consent: true,
  });
  expect(screen.getByTitle('Email preview')).toHaveAttribute('sandbox', '');
  expect(screen.getByTitle('Email preview').getAttribute('srcdoc')).toContain('Welcome {name}');
  fireEvent.click(screen.getByRole('button', { name: 'Discard suggestion' }));
  expect(props.onApply).not.toHaveBeenCalled();
});

test('a late response cannot replace a newer editor draft', async () => {
  let resolve;
  generateEmailSuggestion.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { rerender } = render(<AiAssist {...props} />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  const signal = generateEmailSuggestion.mock.calls[0][1];
  rerender(<AiAssist {...props} body="My newer draft" />);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ subject: 'Old', body: 'Old' }));
  expect(screen.queryByRole('button', { name: 'Apply to draft' })).not.toBeInTheDocument();
  expect(props.onApply).not.toHaveBeenCalled();
});

test('changing format or fields discards an already generated suggestion', async () => {
  const { rerender } = render(<AiAssist {...props} />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByRole('region', { name: 'AI suggestion' });
  rerender(<AiAssist {...props} isHtml fields={['email']} />);
  expect(screen.queryByRole('button', { name: 'Apply to draft' })).not.toBeInTheDocument();
});

test('cancel and unmount abort generation; subsequent requests remain possible', async () => {
  generateEmailSuggestion.mockImplementation(() => new Promise(() => {}));
  const { unmount } = render(<AiAssist {...props} />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel generation' }));
  expect(generateEmailSuggestion.mock.calls[0][1].aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  expect(generateEmailSuggestion).toHaveBeenCalledTimes(2);
  unmount();
  expect(generateEmailSuggestion.mock.calls[1][1].aborted).toBe(true);
});

test('quota failure leaves the draft alone and allows retry', async () => {
  generateEmailSuggestion.mockRejectedValue(new Error('AI quota is exhausted.'));
  render(<AiAssist {...props} />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('AI quota is exhausted.');
  expect(props.onApply).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Generate suggestion' })).toBeEnabled()
  );
});

test('missing configuration presents an optional unavailable state', async () => {
  getAiStatus.mockResolvedValue({ available: false });
  render(<AiAssist {...props} />);
  expect(await screen.findByText(/isn’t enabled/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Generate suggestion' })).not.toBeInTheDocument();
});

test('HTML preview stays inert and Apply is disabled while the editor is busy', async () => {
  generateEmailSuggestion.mockResolvedValue({
    subject: 'Hi {name}',
    body: '<script>alert(1)</script>',
    is_html: true,
  });
  const { rerender, container } = render(<AiAssist {...props} isHtml />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByLabelText('Suggested body (HTML source)');
  expect(container.querySelector('script')).toBeNull();
  rerender(<AiAssist {...props} isHtml disabled />);
  expect(screen.getByRole('button', { name: 'Apply to draft' })).toBeDisabled();
});
