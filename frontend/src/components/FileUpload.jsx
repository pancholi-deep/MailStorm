import React from 'react';

export default function FileUpload({ id, label, filename, status, description, accept, disabled, inputRef, onChange, onDrop, chooseLabel, replaceLabel }) {
  return (
    <div className={`file-upload ${filename ? 'has-file' : ''}`} onDragOver={event => event.preventDefault()} onDrop={onDrop}>
      <span className="file-symbol" aria-hidden="true">{filename ? '✓' : '↥'}</span>
      <div className="file-description" aria-live="polite">
        {filename && <span className="file-status">{status}</span>}
        <strong>{filename || label}</strong>
        <p className="muted">{description}</p>
      </div>
      <label className={`ws-button file-picker ${disabled ? 'is-disabled' : ''}`} htmlFor={id}>
        {filename ? replaceLabel : chooseLabel}
        <input ref={inputRef} id={id} type="file" accept={accept} aria-label={label} disabled={disabled} onChange={onChange} />
      </label>
    </div>
  );
}
