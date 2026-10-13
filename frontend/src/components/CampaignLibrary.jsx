import React, { useEffect, useRef, useState } from 'react';
import { listSavedCampaigns, loadSavedCampaign, deleteSavedCampaign } from '../utils/campaignLibraryApi';

export default function CampaignLibrary({ selected, name, onName, dirty, disabled, onBusy, onOpen, onSave, onNew, children }) {
  const [campaigns, setCampaigns] = useState([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const locked = useRef(false);
  const nameInput = useRef(null);
  const searchInput = useRef(null);

  useEffect(() => {
    let active = true;
    listSavedCampaigns().then(rows => { if (active) setCampaigns(rows); })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const act = async operation => {
    if (locked.current || disabled) return;
    locked.current = true;
    onBusy(true);
    setError(''); setNotice('');
    try { await operation(); }
    catch (err) { setError(err.message); }
    finally { locked.current = false; onBusy(false); }
  };
  const canLeave = () => !dirty || window.confirm('Discard the unsaved changes in this editor?');
  const focusEditor = () => {
    setExpanded(false);
    // The editor is enabled again after the async library action completes.
    requestAnimationFrame(() => nameInput.current?.focus());
  };
  const open = id => act(async () => {
    if (!canLeave()) return;
    onOpen(await loadSavedCampaign(id));
    setNotice('Campaign opened. Its contact list is ready to reuse.');
    focusEditor();
  });
  const save = copy => act(async () => {
    const saved = await onSave(copy);
    setCampaigns(rows => [saved, ...rows.filter(row => row.id !== saved.id)]);
    setSearch('');
    setNotice(copy ? 'New campaign copy saved.' : 'Campaign saved.');
  });
  const remove = (campaign, fromLibrary = false) => act(async () => {
    if (!campaign) return;
    const isCurrent = selected?.id === campaign.id;
    const target = isCurrent ? selected : campaign;
    if (!window.confirm(`Delete saved campaign “${target.name}”?${isCurrent && dirty ? ' Unsaved edits will also be discarded.' : ''} Existing sends will be kept.`)) return;
    await deleteSavedCampaign(target.id, target.revision);
    setCampaigns(rows => rows.filter(row => row.id !== target.id));
    if (isCurrent) onNew();
    setNotice('Saved campaign deleted. Existing sends are unchanged.');
    if (fromLibrary) requestAnimationFrame(() => searchInput.current?.focus());
    else focusEditor();
  });
  const create = () => {
    if (locked.current || disabled || !canLeave()) return;
    onNew(); setNotice(''); setError(''); focusEditor();
  };
  const visible = campaigns.filter(row => row.name.toLowerCase().includes(search.trim().toLowerCase()));

  return <div className="workspace-layout">
    <aside className="campaign-sidebar" aria-label="Campaign library">
      <div className="library-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>Campaigns <span className="count-badge">{campaigns.length}</span></h2></div>
        <button type="button" className="ws-button library-toggle" aria-expanded={expanded} aria-controls="campaign-browser" onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide library' : 'Browse campaigns'}</button>
      </div>
      <button type="button" className="ws-button primary new-campaign" disabled={disabled} onClick={create}><span aria-hidden="true">＋</span> New campaign</button>
      <div id="campaign-browser" className={`campaign-browser ${expanded ? 'is-expanded' : ''}`}>
        <label className="sr-only" htmlFor="campaign-search">Search campaigns</label>
        <input ref={searchInput} id="campaign-search" className="ws-input campaign-search" type="search" placeholder="Search campaigns…" value={search} onChange={e => setSearch(e.target.value)} />
        <p className="library-label">SAVED CAMPAIGNS</p>
        {loading ? <p className="library-empty" role="status">Loading campaigns…</p> : visible.length ? <ul className="campaign-list">
          {visible.map(row => <li key={row.id} className={`campaign-row ${selected?.id === row.id ? 'is-selected' : ''}`}>
            <button type="button" className="campaign-item" disabled={disabled} aria-current={selected?.id === row.id ? 'true' : undefined} onClick={() => open(row.id)}>
              <span className="campaign-symbol" aria-hidden="true">✉</span><span className="campaign-item-text"><strong title={row.name}>{row.name}</strong><span>{row.recipient_count.toLocaleString()} contacts</span></span>
            </button>
            <button type="button" className="campaign-delete-icon" disabled={disabled} aria-label={`Delete campaign “${row.name}”`} title={`Delete ${row.name}`} onClick={() => remove(row, true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg>
            </button>
          </li>)}
        </ul> : <div className="library-empty"><strong>{search ? 'No matching campaigns' : 'Your first campaign starts here'}</strong><p>{search ? 'Try a different name.' : 'Save a contact list and message together. They’ll be ready the next time you return.'}</p></div>}
      </div>
      <div className="library-note"><span className="note-icon" aria-hidden="true">↗</span><strong>Write once. Make it personal.</strong><p>Add {'{name}'} to your message to greet each contact by name.</p></div>
      <a className="privacy-link" href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy ↗</a>
    </aside>

    <main className="campaign-editor" aria-label="Campaign editor">
      <header className="editor-heading"><div><p className="eyebrow">CAMPAIGN EDITOR</p><h1>{selected ? 'Make it your next great email.' : 'Start a conversation.'}</h1><p className="muted">Your audience and message, together in one place.</p></div><span className={`save-badge ${dirty ? 'is-dirty' : ''}`}>{selected ? (dirty ? 'Unsaved changes' : 'Saved') : 'Draft'}</span></header>
      <section className="campaign-identity" aria-label="Campaign details">
        <div className="campaign-name-field"><label className="field-label" htmlFor="campaign-name">Campaign name <span className="muted">· for your reference</span></label><input ref={nameInput} id="campaign-name" className="ws-input" value={name} maxLength={120} disabled={disabled} onChange={e => onName(e.target.value)} placeholder="e.g. Sales outreach" /></div>
        <div className="campaign-save-actions"><button type="button" disabled={disabled || !name.trim()} onClick={() => save(false)} className="ws-button secondary">{selected ? 'Save changes' : 'Save campaign'}</button>
          {selected && <button type="button" disabled={disabled || !name.trim()} onClick={() => save(true)} className="ws-button">Save as new copy</button>}
          {selected && <button type="button" disabled={disabled} onClick={() => remove(selected)} className="ws-button delete-campaign">Delete campaign</button>}
        </div>
        <p className="save-help muted">Save to reuse later. Sending uses your current edits and doesn’t save them.</p>
      </section>
      {notice && <p role="status" className="workspace-notice">{notice}</p>}
      {error && <p role="alert" className="workspace-error">{error}</p>}
      {children}
    </main>
  </div>;
}
