import React from 'react';
import './ContentRiskReview.css';

export default function ContentRiskReview({ review, stale, children }) {
  if (!review) return null;
  const available = Number.isFinite(review.score);
  const ai = review.source === 'gemini';
  return (
    <section
      className={`content-risk ${stale ? 'is-stale' : review.level}`}
      aria-label="Saved draft content review"
    >
      <div className="content-risk-heading">
        <div>
          <h3>Content spam-risk</h3>
          <p className="muted">
            {ai ? 'AI-assisted content assessment' : 'Heuristic score'}—not Gmail’s probability of
            marking this email as spam.
          </p>
        </div>
        <div className="content-risk-score" role="status">
          {stale ? (
            <strong>Needs recheck</strong>
          ) : available ? (
            <>
              <strong>{review.score}%</strong>
              <span>{review.level} content warnings</span>
            </>
          ) : (
            <strong>Check unavailable</strong>
          )}
        </div>
      </div>
      {stale ? (
        <p>Draft changed. Save again to update this check.</p>
      ) : available ? (
        <>
          <meter min="0" max="100" value={review.score} aria-label="Content warning score" />
          {ai && <p>{review.summary}</p>}
          {review.findings.length ? (
            <ul className="content-risk-findings">
              {review.findings.map((finding) => (
                <li key={finding.code}>
                  <strong>
                    {finding.title}{' '}
                    {Number.isFinite(finding.points) && (
                      <span className="muted">
                        {ai ? 'Technical check · ' : '+'}
                        {finding.points} points
                      </span>
                    )}
                  </strong>
                  {finding.excerpt && <blockquote>{finding.excerpt}</blockquote>}
                  <p>{finding.suggestion}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No checked content warnings found. This does not guarantee inbox placement.</p>
          )}
        </>
      ) : (
        <p>{review.message}</p>
      )}
      {children}
      <details>
        <summary>What this score can tell you</summary>
        {ai ? (
          <p>
            Gemini reviews wording in context using a fixed rubric. The displayed score is the
            higher of its assessment ({review.ai_score}/100) and the technical warning total (
            {review.technical_score}/100), so AI cannot dismiss detected unsafe links, scripts,
            hidden content, misleading links, or oversized HTML. These values are not added
            together. Model assessments can be wrong or vary. Results for unchanged content may be
            reused for up to 15 minutes on the same server.
          </p>
        ) : (
          <p>
            MailStorm adds fixed warning points, capped at 100: low below 25, moderate from 25, high
            from 50. These are uncalibrated editorial rules, not a Gmail prediction. Checks run
            locally on the server when you save or reopen a campaign, without an AI request.
          </p>
        )}
        {ai && (
          <p>
            Model: {review.model}. Low below 25, moderate from 25, high from 50. No paid fallback is
            used.
          </p>
        )}
        <p>
          The score checks the template before CSV personalization. It cannot assess sender
          reputation, SPF/DKIM/DMARC, recipient consent, complaints, or the final delivery outcome.
          A low score does not make unsolicited mail safe to send.
        </p>
        <p>
          Send to people who expect your email, identify yourself clearly, and provide a working
          unsubscribe option for marketing or subscription mail. Review the{' '}
          <a
            href="https://support.google.com/mail/answer/81126?hl=en"
            target="_blank"
            rel="noreferrer"
          >
            Gmail sender guidelines
          </a>
          .
        </p>
      </details>
    </section>
  );
}
