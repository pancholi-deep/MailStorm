import React from 'react';
import useContentReview from '../../hooks/useContentReview';
import ContentRiskReview from './ContentRiskReview';

export default function SavedContentReview({ saved, stale }) {
  const ai = useContentReview(saved, stale);
  if (!saved?.content_review) return null;
  return (
    <ContentRiskReview review={ai.review || saved.content_review} stale={stale}>
      <div className="content-review-ai">
        <label className="content-review-consent">
          <input
            type="checkbox"
            checked={ai.enabled}
            onChange={(e) => ai.setEnabled(e.target.checked)}
          />
          Use Gemini to review this saved draft and future saves while this campaign is open. I
          confirm this email contains no personal or confidential information.
        </label>
        <p className="muted">
          This shares the subject, email text, and link information with Google Gemini. CSV rows and
          account credentials are not attached. Google’s free service may use inputs and outputs for
          product improvement and human review.{' '}
          <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">
            Google’s AI terms
          </a>
        </p>
        {ai.status === 'loading' && (
          <p role="status">
            Campaign saved. Gemini is reviewing the content… You can keep editing. Showing local
            checks while you wait.
          </p>
        )}
        {ai.status === 'error' && (
          <div role="status">
            <p>AI review unavailable. Showing local checks. {ai.error}</p>
            <button type="button" className="ws-button secondary" onClick={ai.retry}>
              Retry AI review
            </button>
          </div>
        )}
        {ai.status === 'ready' && (
          <p role="status">
            AI review complete{ai.review.cached ? ' · reused an unchanged-content result' : ''}.
            Technical checks remain included.
          </p>
        )}
        {ai.enabled && stale && <p>Save your changes to request a new AI review.</p>}
      </div>
    </ContentRiskReview>
  );
}
