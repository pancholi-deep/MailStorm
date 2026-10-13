import React from 'react';
import FileUpload from '../FileUpload';
import ComposerSection from './ComposerSection';

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
    <ComposerSection
      id="recipients"
      step="01"
      title="Recipients"
      description="Choose who you want to reach."
      summary={`${csvFile?.name || contacts?.filename || 'No CSV selected'}${contacts?.recipient_count != null ? ` · ${contacts.recipient_count.toLocaleString()} contacts` : ''}`}
      actions={contacts && <span className="ready-badge">Ready to reuse</span>}
      notice={
        csvError && (
          <p role="alert" className="workspace-error">
            {csvError}
          </p>
        )
      }
    >
      <FileUpload
        id="csv-upload"
        label={contacts ? 'Replace contact CSV (optional)' : 'Upload CSV'}
        filename={csvFile?.name || contacts?.filename}
        status={contacts ? 'Saved file' : 'Selected file'}
        description={
          contacts
            ? `${contacts.recipient_count != null ? contacts.recipient_count.toLocaleString() + ' contacts · ' : ''}Saved with this campaign`
            : csvFile
              ? 'CSV selected · fields checked automatically'
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
    </ComposerSection>
  );
}
