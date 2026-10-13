import React, { useRef, useState } from 'react';
import useCampaignLibrary from '../hooks/useCampaignLibrary';
import CampaignSidebar from './campaign/CampaignSidebar';
import CampaignDetails from './campaign/CampaignDetails';

export default function CampaignLibrary({
  selected,
  name,
  onName,
  dirty,
  disabled,
  onBusy,
  onOpen,
  onSave,
  onNew,
  children,
  fieldsPanel,
  fieldsOpen,
}) {
  const [expanded, setExpanded] = useState(false);
  const nameInput = useRef(null);
  const searchInput = useRef(null);
  const focusEditor = () => {
    setExpanded(false);
    // Wait until the async library action enables the editor again.
    requestAnimationFrame(() => nameInput.current?.focus());
  };
  const focusLibrary = () => requestAnimationFrame(() => searchInput.current?.focus());
  const {
    campaigns,
    search,
    setSearch,
    visible,
    error,
    notice,
    loading,
    open,
    save,
    remove,
    create,
  } = useCampaignLibrary({
    selected,
    dirty,
    disabled,
    onBusy,
    onOpen,
    onSave,
    onNew,
    focusEditor,
    focusLibrary,
    confirm: (message) => window.confirm(message),
  });

  return (
    <div
      className={`workspace-layout ${fieldsPanel ? `has-fields-panel ${fieldsOpen ? 'fields-expanded' : 'fields-collapsed'}` : ''}`}
    >
      <CampaignSidebar
        campaigns={campaigns}
        selected={selected}
        expanded={expanded}
        setExpanded={setExpanded}
        disabled={disabled}
        create={create}
        searchInput={searchInput}
        search={search}
        setSearch={setSearch}
        loading={loading}
        visible={visible}
        open={open}
        remove={remove}
      />

      <main className="campaign-editor" aria-label="Campaign editor">
        <CampaignDetails
          selected={selected}
          dirty={dirty}
          nameInput={nameInput}
          name={name}
          onName={onName}
          disabled={disabled}
          save={save}
          remove={remove}
        />
        {notice && (
          <p role="status" className="workspace-notice">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="workspace-error">
            {error}
          </p>
        )}
        {children}
      </main>
      {fieldsPanel}
    </div>
  );
}
