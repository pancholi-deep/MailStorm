import React, { useEffect, useRef, useState } from 'react';
import { generateEmailSuggestion, getAiStatus } from '../../utils/aiApi';
import HtmlEmailPreview from './HtmlEmailPreview';
import './AiAssist.css';

export default function AiAssist({ subject, body, isHtml, fields, disabled, onApply }) {
  const [availability, setAvailability] = useState('loading');
  const [action, setAction] = useState(body.trim() ? 'proofread' : 'draft');
  const [brief, setBrief] = useState('');
  const [tone, setTone] = useState('professional');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const pending = useRef(null);
  const revision = JSON.stringify([subject, body, isHtml, fields]);
  const current = useRef(revision);
  current.current = revision;

  useEffect(() => {
    const controller = new AbortController();
    getAiStatus(controller.signal)
      .then((status) => {
        if (!controller.signal.aborted) setAvailability(status.available ? 'ready' : 'off');
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability('error');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    // Discard responses after typing, importing, changing format/contacts, or leaving the panel.
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setSuggestion(null);
    setError('');
    return () => pending.current?.abort();
  }, [revision]);

  const generate = async () => {
    if (disabled || pending.current || !consent) return;
    setError('');
    setSuggestion(null);
    if (action === 'draft' && !brief.trim()) {
      setError('Describe the email you want to write.');
      return;
    }
    if (action !== 'draft' && (!body.trim() || body.length > 20000 || subject.length > 998)) {
      setError(
        'Rewriting needs an email body of up to 20,000 characters and a subject of up to 998 characters.'
      );
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const result = await generateEmailSuggestion(
        {
          action,
          brief: action === 'draft' ? brief : '',
          tone,
          subject: action === 'draft' ? '' : subject,
          body: action === 'draft' ? '' : body,
          is_html: action === 'draft' ? true : isHtml,
          fields: action === 'draft' ? fields : [],
          consent: true,
        },
        controller.signal
      );
      if (!controller.signal.aborted && current.current === revision)
        setSuggestion({ ...result, revision });
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <section className="ai-assist" id="ai-assist-panel" aria-labelledby="ai-assist-title">
      <div className="ai-assist-heading">
        <h3 id="ai-assist-title">AI Assist</h3>
        <span className="muted">Write · refine · review</span>
      </div>
      {availability !== 'ready' ? (
        <p role="status" className="muted">
          {availability === 'loading'
            ? 'Checking AI availability…'
            : availability === 'off'
              ? 'AI Assist isn’t enabled for this app yet. You can keep writing and sending manually.'
              : 'Couldn’t check AI availability. Close and reopen AI Assist to retry. Your editor is still available.'}
        </p>
      ) : (
        <>
          <div className="ai-assist-options">
            <label className="field-label">
              Writing task
              <select
                className="ws-input"
                value={action}
                disabled={busy || disabled}
                onChange={(e) => {
                  setAction(e.target.value);
                  setSuggestion(null);
                  setError('');
                }}
              >
                <option value="draft">Draft from a brief</option>
                <option value="shorten">Shorten</option>
                <option value="proofread">Proofread</option>
                <option value="tone">Change tone</option>
              </select>
            </label>
            {(action === 'draft' || action === 'tone') && (
              <label className="field-label">
                Tone
                <select
                  className="ws-input"
                  value={tone}
                  disabled={busy || disabled}
                  onChange={(e) => {
                    setTone(e.target.value);
                    setSuggestion(null);
                  }}
                >
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="formal">Formal</option>
                </select>
              </label>
            )}
          </div>
          {action === 'draft' && (
            <label className="field-label">
              What should the email say?
              <textarea
                className="ws-input"
                rows={3}
                maxLength={2000}
                value={brief}
                disabled={busy || disabled}
                onChange={(e) => {
                  setBrief(e.target.value);
                  setSuggestion(null);
                }}
                placeholder="Introduce our reporting product and ask for a 15-minute demo. Use {name} for the greeting."
              />
              <span className="muted ai-assist-fields">
                Creates a formatted HTML email.{' '}
                {fields.length
                  ? `Available placeholders: ${fields.map((field) => `{${field}}`).join(', ')}`
                  : 'Upload a CSV to use placeholders in a new draft.'}
              </span>
            </label>
          )}
          <p className="ai-assist-disclosure muted">
            {action === 'draft'
              ? 'Generate sends your brief and available placeholder names to Google Gemini.'
              : 'Generate sends your subject and email text to Google Gemini.'}{' '}
            Your contact list and account credentials aren’t attached. Google’s free service may use
            inputs and outputs for model improvement and human review. Keep personal, sensitive, and
            confidential information out of the text you share.{' '}
            <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">
              Google’s AI terms
            </a>
          </p>
          <label className="ai-assist-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || disabled}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I’m only sharing nonconfidential content without personal information.
          </label>
          <div className="ai-assist-actions">
            <button
              type="button"
              className="ws-button secondary"
              disabled={busy || disabled || !consent}
              onClick={generate}
            >
              {busy ? 'Writing…' : 'Generate suggestion'}
            </button>
            {busy && (
              <button
                type="button"
                className="ws-button"
                onClick={() => {
                  pending.current?.abort();
                  pending.current = null;
                  setBusy(false);
                }}
              >
                Cancel generation
              </button>
            )}
          </div>
          {busy && (
            <p role="status" className="muted">
              Your draft stays unchanged while AI writes.
            </p>
          )}
          {error && (
            <p role="alert" className="workspace-error">
              {error}
            </p>
          )}
          {suggestion && suggestion.revision === revision && (
            <div className="ai-assist-preview" role="region" aria-label="AI suggestion">
              <p role="status">
                Suggestion ready. Review it before replacing your subject and body.
              </p>
              <label className="field-label">
                Suggested subject
                <textarea className="ws-input" readOnly rows={2} value={suggestion.subject} />
              </label>
              {suggestion.is_html ? (
                <>
                  <HtmlEmailPreview body={suggestion.body} />
                  <details className="ai-html-source">
                    <summary>View HTML source</summary>
                    <label className="field-label">
                      Suggested body (HTML source)
                      <textarea className="ws-input" readOnly rows={7} value={suggestion.body} />
                    </label>
                  </details>
                </>
              ) : (
                <label className="field-label">
                  Suggested body
                  <textarea className="ws-input" readOnly rows={7} value={suggestion.body} />
                </label>
              )}
              <p className="muted">
                Check facts and wording. Applying changes your current draft; save the campaign when
                you’re ready.
              </p>
              <div className="ai-assist-actions">
                <button
                  type="button"
                  className="ws-button primary"
                  disabled={disabled || busy}
                  onClick={() => {
                    if (suggestion.revision !== current.current || disabled) return;
                    onApply(suggestion);
                    setSuggestion(null);
                  }}
                >
                  Apply to draft
                </button>
                <button type="button" className="ws-button" onClick={() => setSuggestion(null)}>
                  Discard suggestion
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
