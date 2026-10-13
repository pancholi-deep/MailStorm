import React from 'react';
import FileUpload from '../FileUpload';

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
}) {
  return (
    <section className="composer-section" aria-labelledby="message-heading">
      <div className="section-heading">
        <span className="step-number">02</span>
        <div>
          <h2 id="message-heading">Message</h2>
          <p className="muted">Make every email feel personal.</p>
        </div>
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
      </div>
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
          {templateError && (
            <p role="alert" className="workspace-error">
              {templateError}
            </p>
          )}
        </div>
      )}
      <label className="field-label" htmlFor="email-subject">
        Email Subject
      </label>
      <input
        id="email-subject"
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
        className={`ws-input message-body ${isHtml ? 'html-body' : ''}`}
        value={emailBody}
        onChange={(e) => setEmailBody(e.target.value)}
        disabled={editorBusy}
        placeholder={'Hi {name},\n\nLet’s start a conversation…'}
        required
        rows={9}
      />
      <div className="message-hint">
        <span>
          Personalize with <code>{'{name}'}</code> and <code>{'{email}'}</code>.
        </span>
        <span>{isHtml ? 'HTML source' : 'Plain text'}</span>
      </div>
    </section>
  );
}
