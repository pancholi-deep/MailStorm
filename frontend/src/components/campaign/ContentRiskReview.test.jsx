import React from 'react';
import { render, screen } from '@testing-library/react';
import ContentRiskReview from './ContentRiskReview';

const review = {
  score: 60,
  level: 'high',
  findings: [
    {
      code: 'pressure',
      title: 'High-pressure wording',
      points: 10,
      suggestion: 'Use concrete benefits.',
    },
  ],
};

test('shows an explicitly heuristic score with actionable suggestions and limitations', () => {
  render(<ContentRiskReview review={review} />);
  expect(screen.getByText('60%')).toBeInTheDocument();
  expect(screen.getByText(/not Gmail’s probability/)).toBeInTheDocument();
  expect(screen.getByText('Use concrete benefits.')).toBeInTheDocument();
  expect(screen.getByText('+10 points')).toBeInTheDocument();
  expect(screen.getByRole('meter')).toHaveAttribute('value', '60');
});

test('changed content hides the old score and asks for a new save', () => {
  render(<ContentRiskReview review={review} stale />);
  expect(screen.queryByText('60%')).not.toBeInTheDocument();
  expect(screen.queryByText('Use concrete benefits.')).not.toBeInTheDocument();
  expect(screen.getByText(/Draft changed/)).toBeInTheDocument();
});

test('zero does not promise delivery and unavailable is never presented as zero', () => {
  const { rerender } = render(
    <ContentRiskReview review={{ score: 0, level: 'low', findings: [] }} />
  );
  expect(screen.getByText('0%')).toBeInTheDocument();
  expect(screen.getByText(/does not guarantee inbox placement/)).toBeInTheDocument();
  rerender(
    <ContentRiskReview review={{ score: null, message: 'Could not analyze this markup.' }} />
  );
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
  expect(screen.getByText('Could not analyze this markup.')).toBeInTheDocument();
});
