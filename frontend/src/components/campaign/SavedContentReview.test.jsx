import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SavedContentReview from './SavedContentReview';
import { reviewSavedCampaign } from '../../utils/aiApi';

jest.mock('../../utils/aiApi', () => ({ reviewSavedCampaign: jest.fn() }));
const saved = {
  id: 'sales',
  revision: 1,
  subject: 'Hello',
  body: 'An update',
  is_html: false,
  content_review: { score: 30, level: 'moderate', findings: [] },
};
const result = {
  campaign_id: 'sales',
  revision: 1,
  source: 'gemini',
  score: 0,
  ai_score: 0,
  technical_score: 0,
  level: 'low',
  summary: 'No substantial concerns.',
  findings: [],
  model: 'gemini-test',
  cached: false,
};
beforeEach(() => reviewSavedCampaign.mockResolvedValue(result));

test('consent is required; reviewing does not block editing and uses AI output with attribution', async () => {
  render(<SavedContentReview saved={saved} stale={false} />);
  expect(reviewSavedCampaign).not.toHaveBeenCalled();
  expect(screen.getByText('30%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText(/Gemini is reviewing/)).toBeInTheDocument();
  await screen.findByText('0%');
  expect(screen.getByText(/AI-assisted content assessment/)).toBeInTheDocument();
  expect(screen.getByText('No substantial concerns.')).toBeInTheDocument();
  expect(reviewSavedCampaign).toHaveBeenCalledWith(saved, expect.any(AbortSignal));
});

test('timeout falls back to local checks and supports an explicit retry', async () => {
  reviewSavedCampaign.mockRejectedValueOnce(new Error('Google did not respond in time.'));
  render(<SavedContentReview saved={saved} />);
  fireEvent.click(screen.getByRole('checkbox'));
  await screen.findByText(/AI review unavailable. Showing local checks/);
  expect(screen.getByText('30%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry AI review' }));
  await screen.findByText('0%');
});

test('editing or withdrawing consent aborts and ignores a late assessment', async () => {
  let resolve;
  reviewSavedCampaign.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { rerender } = render(<SavedContentReview saved={saved} />);
  fireEvent.click(screen.getByRole('checkbox'));
  const signal = reviewSavedCampaign.mock.calls[0][1];
  rerender(<SavedContentReview saved={saved} stale />);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(result));
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
  expect(screen.getByText('Needs recheck')).toBeInTheDocument();
  rerender(<SavedContentReview saved={{ ...saved, revision: 2 }} />);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(reviewSavedCampaign.mock.calls[1][1].aborted).toBe(true);
  await act(async () => resolve({ ...result, revision: 2 }));
  expect(screen.getByText('30%')).toBeInTheDocument();
});

test('new saved revisions are reviewed and switching campaigns resets consent', async () => {
  const { rerender } = render(<SavedContentReview key="sales" saved={saved} />);
  fireEvent.click(screen.getByRole('checkbox'));
  await screen.findByText('0%');
  reviewSavedCampaign.mockResolvedValue({ ...result, revision: 2, cached: true });
  rerender(<SavedContentReview key="sales" saved={{ ...saved, revision: 2 }} />);
  await screen.findByText(/reused an unchanged-content result/);
  rerender(<SavedContentReview key="other" saved={{ ...saved, id: 'other' }} />);
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByText('30%')).toBeInTheDocument();
  expect(reviewSavedCampaign).toHaveBeenCalledTimes(2);
});

test('a mismatched server revision never displays its score', async () => {
  reviewSavedCampaign.mockResolvedValue({ ...result, revision: 99 });
  render(<SavedContentReview saved={saved} />);
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(screen.getByText(/reviewed version changed/)).toBeInTheDocument());
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
});
