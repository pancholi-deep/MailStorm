import React from 'react';
import { previewMessage, templateFields } from '../../utils/personalization';

export default function PersonalizationPanel({
  fieldInfo,
  fieldsLoading,
  fieldsError,
  fieldMapping,
  missing,
  setMapping,
  emailSubject,
  emailBody,
  isHtml,
  editorBusy,
  expanded,
  setExpanded,
}) {
  const fields = templateFields(emailSubject, emailBody);
  const columns = fieldInfo?.columns || [];
  const sample = fieldInfo?.sample;
  return (
    <aside
      className={`personalization-panel ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      aria-label="Fields & preview"
    >
      <div className="fields-panel-inner">
        <button
          id="fields-panel-toggle"
          type="button"
          className="fields-panel-toggle"
          aria-expanded={expanded}
          aria-controls="fields-panel-content"
          onClick={() => setExpanded(!expanded)}
        >
          <span aria-hidden="true">{expanded ? '›' : '‹'}</span>
          <span>Fields &amp; preview</span>
        </button>
        <div id="fields-panel-content" className="personalization-content" hidden={!expanded}>
          <p>
            Use <code>{'{column}'}</code> in the subject or body to insert a value from each
            contact’s CSV row.
          </p>
          <details className="fields-guide">
            <summary>How to use fields</summary>
            <p>
              Headers are trimmed and lowercased. For example, a <strong>Company</strong> column
              works as <code>{'{company}'}</code>.
            </p>
            <p>
              For a different name or a column with spaces, type a placeholder such as{' '}
              <code>{'{company}'}</code>, then choose its column below. Placeholder names use
              letters, numbers and underscores, and cannot start with a number.
            </p>
            <p>
              <code>{'{name}'}</code> uses the first word of the name. <code>{'{email}'}</code> uses
              the recipient’s email. These two fields are fixed. Blank custom cells insert empty
              text.
            </p>
          </details>
          {fieldsLoading && <p role="status">Reading CSV fields…</p>}
          {fieldsError && <p className="workspace-error">{fieldsError}</p>}
          {!fieldInfo && !fieldsLoading && !fieldsError && (
            <p className="muted">Choose a CSV to see available fields and a preview.</p>
          )}
          {fieldInfo && (
            <>
              <h3>Map placeholders</h3>
              <p className="muted">
                Every placeholder must use an existing CSV column. Mappings are saved with your
                campaign.
              </p>
              {!fields.length && (
                <p className="muted">Insert a field or type a placeholder to start mapping.</p>
              )}
              {fields.map((key) => {
                const column = Object.hasOwn(fieldMapping, key) ? fieldMapping[key] : key;
                const fixed = key === 'name' || key === 'email';
                return (
                  <div className="mapping-row" key={key}>
                    <label htmlFor={`mapping-${key}`}>
                      <code>{`{${key}}`}</code>
                      {fixed ? ' · fixed' : ''}
                    </label>
                    <select
                      id={`mapping-${key}`}
                      className="ws-input"
                      aria-label={`CSV column for {${key}}`}
                      aria-invalid={missing.includes(key)}
                      disabled={editorBusy || fixed}
                      value={columns.includes(column) ? column : ''}
                      onChange={(event) =>
                        setMapping((previous) => ({ ...previous, [key]: event.target.value }))
                      }
                    >
                      <option value="" disabled>
                        Choose a CSV column
                      </option>
                      {columns.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              {sample && (
                <div className="personalization-preview">
                  <h3>First contact preview</h3>
                  <p className="muted">
                    {isHtml ? 'Personalized HTML source' : 'Personalized text'} · {sample.email}
                  </p>
                  {missing.length > 0 && (
                    <p className="muted">Unmapped placeholders remain visible below.</p>
                  )}
                  <strong>Subject</strong>
                  <pre>
                    {previewMessage(emailSubject, sample, fieldMapping) ||
                      'Your subject will appear here.'}
                  </pre>
                  <strong>Body</strong>
                  <pre>
                    {previewMessage(emailBody, sample, fieldMapping, isHtml) ||
                      'Your message will appear here.'}
                  </pre>
                  <p className="muted">
                    Preview shows up to 2,000 characters per field. Check your CSV for blanks in
                    other rows before sending.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
