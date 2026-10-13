import React from 'react';

export default function CampaignDetails({
  selected,
  dirty,
  nameInput,
  name,
  onName,
  disabled,
  save,
  remove,
}) {
  return (
    <>
      <header className="editor-heading">
        <div>
          <p className="eyebrow">CAMPAIGN EDITOR</p>
          <h1>{selected ? 'Make it your next great email.' : 'Start a conversation.'}</h1>
          <p className="muted">Your audience and message, together in one place.</p>
        </div>
        <span className={`save-badge ${dirty ? 'is-dirty' : ''}`}>
          {selected ? (dirty ? 'Unsaved changes' : 'Saved') : 'Draft'}
        </span>
      </header>
      <section className="campaign-identity" aria-label="Campaign details">
        <div className="campaign-name-field">
          <label className="field-label" htmlFor="campaign-name">
            Campaign name <span className="muted">· for your reference</span>
          </label>
          <input
            ref={nameInput}
            id="campaign-name"
            className="ws-input"
            value={name}
            maxLength={120}
            disabled={disabled}
            onChange={(e) => onName(e.target.value)}
            placeholder="e.g. Sales outreach"
          />
        </div>
        <div className="campaign-save-actions">
          <button
            type="button"
            disabled={disabled || !name.trim()}
            onClick={() => save(false)}
            className="ws-button secondary"
          >
            {selected ? 'Save changes' : 'Save campaign'}
          </button>
          {selected && (
            <button
              type="button"
              disabled={disabled || !name.trim()}
              onClick={() => save(true)}
              className="ws-button"
            >
              Save as new copy
            </button>
          )}
          {selected && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => remove(selected)}
              className="ws-button delete-campaign"
            >
              Delete campaign
            </button>
          )}
        </div>
        <p className="save-help muted">
          Save to reuse later. Sending uses your current edits and doesn’t save them.
        </p>
      </section>
    </>
  );
}
