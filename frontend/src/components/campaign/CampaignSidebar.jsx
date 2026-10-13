import React from 'react';

export default function CampaignSidebar({
  campaigns,
  selected,
  expanded,
  setExpanded,
  disabled,
  create,
  searchInput,
  search,
  setSearch,
  loading,
  visible,
  open,
  remove,
}) {
  return (
    <aside className="campaign-sidebar" aria-label="Campaign library">
      <div className="library-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h2>
            Campaigns <span className="count-badge">{campaigns.length}</span>
          </h2>
        </div>
        <button
          type="button"
          className="ws-button library-toggle"
          aria-expanded={expanded}
          aria-controls="campaign-browser"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide library' : 'Browse campaigns'}
        </button>
      </div>
      <button
        type="button"
        className="ws-button primary new-campaign"
        disabled={disabled}
        onClick={create}
      >
        <span aria-hidden="true">＋</span> New campaign
      </button>
      <div id="campaign-browser" className={`campaign-browser ${expanded ? 'is-expanded' : ''}`}>
        <label className="sr-only" htmlFor="campaign-search">
          Search campaigns
        </label>
        <input
          ref={searchInput}
          id="campaign-search"
          className="ws-input campaign-search"
          type="search"
          placeholder="Search campaigns…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="library-label">SAVED CAMPAIGNS</p>
        {loading ? (
          <p className="library-empty" role="status">
            Loading campaigns…
          </p>
        ) : visible.length ? (
          <ul className="campaign-list">
            {visible.map((row) => (
              <li
                key={row.id}
                className={`campaign-row ${selected?.id === row.id ? 'is-selected' : ''}`}
              >
                <button
                  type="button"
                  className="campaign-item"
                  disabled={disabled}
                  aria-current={selected?.id === row.id ? 'true' : undefined}
                  onClick={() => open(row.id)}
                >
                  <span className="campaign-symbol" aria-hidden="true">
                    ✉
                  </span>
                  <span className="campaign-item-text">
                    <strong title={row.name}>{row.name}</strong>
                    <span>{row.recipient_count.toLocaleString()} contacts</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="campaign-delete-icon"
                  disabled={disabled}
                  aria-label={`Delete campaign “${row.name}”`}
                  title={`Delete ${row.name}`}
                  onClick={() => remove(row, true)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="library-empty">
            <strong>{search ? 'No matching campaigns' : 'Your first campaign starts here'}</strong>
            <p>
              {search
                ? 'Try a different name.'
                : 'Save a contact list and message together. They’ll be ready the next time you return.'}
            </p>
          </div>
        )}
      </div>
      <div className="library-note">
        <span className="note-icon" aria-hidden="true">
          ↗
        </span>
        <strong>Write once. Make it personal.</strong>
        <p>Add {'{name}'} to your message to greet each contact by name.</p>
      </div>
      <a className="privacy-link" href="/privacy" target="_blank" rel="noopener noreferrer">
        Privacy Policy ↗
      </a>
    </aside>
  );
}
