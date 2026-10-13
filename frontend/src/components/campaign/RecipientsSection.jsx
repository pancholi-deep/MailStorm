import React from 'react';
import FileUpload from '../FileUpload';

export default function RecipientsSection({
  csvFile,
  contacts,
  csvError,
  editorBusy,
  csvInputRef,
  handleFileChange,
  handleFileDrop,
}) {
  return (
    <section className="composer-section" aria-labelledby="recipients-heading">
      <div className="section-heading">
        <span className="step-number">01</span>
        <div>
          <h2 id="recipients-heading">Recipients</h2>
          <p className="muted">Choose who you want to reach.</p>
        </div>
        {contacts && <span className="ready-badge">Ready to reuse</span>}
      </div>
      <FileUpload
        id="csv-upload"
        label={contacts ? 'Replace contact CSV (optional)' : 'Upload CSV'}
        filename={csvFile?.name || contacts?.filename}
        status={contacts ? 'Saved file' : 'Selected file'}
        description={
          contacts
            ? `${contacts.recipient_count != null ? contacts.recipient_count.toLocaleString() + ' contacts · ' : ''}Saved with this campaign`
            : csvFile
              ? 'CSV selected · checked when you save or send'
              : 'Drop a CSV here, or choose a file to get started.'
        }
        accept=".csv"
        disabled={editorBusy}
        inputRef={csvInputRef}
        onChange={(e) => handleFileChange(e, 'csv')}
        onDrop={(e) => handleFileDrop(e, 'csv')}
        chooseLabel="Choose CSV"
        replaceLabel="Replace CSV"
      />
      <p className="field-help muted">
        CSV must include <code>name</code> and <code>email</code> columns.
      </p>
      {csvError && (
        <p role="alert" className="workspace-error">
          {csvError}
        </p>
      )}
    </section>
  );
}
