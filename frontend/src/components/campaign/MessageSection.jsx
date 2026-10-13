import React, { useRef, useState } from 'react';
import AiAssist from './AiAssist';
import FileUpload from '../FileUpload';
import ComposerSection from './ComposerSection';
import { isFieldName } from '../../utils/personalization';

export default function MessageSection({
  templateFile,
  importedTemplateFile,
  showTemplateImport,
  setShowTemplateImport,
  setTemplateError,
  templateError,
  processing,
  editorBusy,
  templateInputRef,
  handleFileChange,
  handleFileDrop,
  handleProcessFiles,
  emailSubject,
  setEmailSubject,
  emailBody,
  setEmailBody,
  isHtml,
  setIsHtml,
  personalization,
  openFields,
  aiSessionKey,
}) {
  const [aiOpen, setAiOpen] = useState(false);
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const activeInput = useRef('body');
  const insertField = (field) => {
    const subject = activeInput.current === 'subject';
    const input = subject ? subjectRef.current : bodyRef.current;
    const value = subject ? emailSubject : emailBody;
    const token = `{${field}}`;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    (subject ? setEmailSubject : setEmailBody)(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const insertable = personalization.fieldInfo?.columns.filter(isFieldName) || [];
  return (
    <ComposerSection
      id="message"
      step="02"
      title="Message"
      description="Make every email feel personal."
      summary={`${emailSubject.trim() || 'No subject yet'} · ${isHtml ? 'HTML' : 'Plain text'}`}
      actions={
        <>
          <button
            type="button"
            className="ws-button secondary"
            disabled={editorBusy}
            aria-expanded={aiOpen}
            aria-controls="ai-assist-panel"
            onClick={() => setAiOpen(!aiOpen)}
          >
            {aiOpen ? 'Close AI Assist' : 'AI Assist'}
          </button>
          <button
            type="button"
            className="ws-button import-toggle"
            disabled={editorBusy}
            aria-expanded={showTemplateImport}
            aria-controls="template-import"
            onClick={() => {
              setShowTemplateImport(!showTemplateImport);
              setTemplateError('');
            }}
          >
            {showTemplateImport ? 'Close import' : 'Import template'}
          </button>
        </>
      }
      notice={
        <>
          {templateError && (
            <p role="alert" className="workspace-error">
              {templateError}
            </p>
          )}
          {personalization.missing.length > 0 && (
            <p role="alert" className="workspace-error">
              Map these placeholders before saving or sending:{' '}
              {personalization.missing.map((key) => `{${key}}`).join(', ')}. Choose their CSV
              columns in Fields &amp; preview.
            </p>
          )}
          {personalization.fieldsError && (
            <p role="alert" className="workspace-error">
              {personalization.fieldsError} Retry reading the fields or replace the CSV.
              <button type="button" className="ws-button" onClick={personalization.retryFields}>
                Retry reading fields
              </button>
            </p>
          )}
        </>
      }
    >
      {aiOpen && (
        <AiAssist
          key={aiSessionKey}
          subject={emailSubject}
          body={emailBody}
          isHtml={isHtml}
          fields={[
            ...new Set([
              ...insertable,
              ...Object.keys(personalization.fieldMapping).filter((key) =>
                personalization.fieldInfo?.columns.includes(personalization.fieldMapping[key])
              ),
            ]),
          ]
            .filter((key) => key.length <= 64)
            .slice(0, 64)}
          disabled={editorBusy}
          onApply={(suggestion) => {
            setEmailSubject(suggestion.subject);
            setEmailBody(suggestion.body);
            setIsHtml(suggestion.is_html);
          }}
        />
      )}
      {(showTemplateImport || templateFile) && (
        <div id="template-import" className="template-import">
          <FileUpload
            id="template-upload"
            label="Upload Template"
            filename={templateFile?.name}
            status={templateFile === importedTemplateFile ? 'Imported file' : 'Selected file'}
            description={
              templateFile
                ? templateFile === importedTemplateFile
                  ? 'Imported into the subject and body below.'
                  : 'Ready to import · choose Use template to apply it.'
                : 'Drop a TXT or HTML file here, or choose a template.'
            }
            accept=".txt,.html"
            disabled={editorBusy}
            inputRef={templateInputRef}
            onChange={(e) => {
              handleFileChange(e, 'template');
              setShowTemplateImport(true);
            }}
            onDrop={(e) => {
              handleFileDrop(e, 'template');
              if (!editorBusy) setShowTemplateImport(true);
            }}
            chooseLabel="Choose template"
            replaceLabel="Replace template"
          />
          {showTemplateImport && (
            <div className="template-import-actions">
              <details className="template-help">
                <summary>Template format</summary>
                <p>TXT</p>
                <pre>{'Subject: Hello {name}\nBody: Your message here'}</pre>
                <p>HTML</p>
                <pre>{'<!-- Subject: Hello {name} -->\n<p>Your message here</p>'}</pre>
              </details>
              <button
                type="button"
                className="ws-button secondary"
                disabled={editorBusy || !templateFile}
                onClick={handleProcessFiles}
              >
                {processing ? 'Importing…' : 'Use template'}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="message-composition">
        <div className="message-fields">
          <div className="field-chips" aria-label="Available CSV fields">
            <span className="muted">Insert a CSV field:</span>
            {insertable.map((field) => (
              <button
                type="button"
                className="field-chip"
                disabled={editorBusy}
                key={field}
                onClick={() => insertField(field)}
                aria-label={`Insert {${field}}`}
              >{`{${field}}`}</button>
            ))}
            {!insertable.length && <span className="muted">Choose a CSV to see its columns.</span>}
          </div>
          {personalization.fieldsLoading && (
            <p role="status" className="field-help muted">
              Reading CSV fields…
            </p>
          )}
          <label className="field-label" htmlFor="email-subject">
            Email Subject
          </label>
          <input
            id="email-subject"
            ref={subjectRef}
            onFocus={() => {
              activeInput.current = 'subject';
            }}
            className="ws-input subject-input"
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            disabled={editorBusy}
            placeholder="A subject worth opening"
            required
          />
          <div className="body-label-row">
            <label className="field-label" htmlFor="email-body">
              Email Body
            </label>
            <label className="html-switch">
              <input
                type="checkbox"
                checked={isHtml}
                disabled={editorBusy}
                onChange={(e) => setIsHtml(e.target.checked)}
              />
              Email body contains HTML
            </label>
          </div>
          <textarea
            id="email-body"
            ref={bodyRef}
            onFocus={() => {
              activeInput.current = 'body';
            }}
            className={`ws-input message-body ${isHtml ? 'html-body' : ''}`}
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            disabled={editorBusy}
            placeholder={'Hi {name},\n\nLet’s start a conversation…'}
            required
            rows={9}
          />
          <div className="message-hint">
            <span>Click a field to insert it at the cursor in your subject or body.</span>
            <span>{isHtml ? 'HTML source' : 'Plain text'}</span>
          </div>
          <button
            type="button"
            className="ws-button secondary fields-open-button"
            onClick={openFields}
            aria-controls="fields-panel-content"
          >
            Open Fields &amp; preview
          </button>
        </div>
      </div>
    </ComposerSection>
  );
}
