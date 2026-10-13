import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/authContext';
import useEmailSending from '../hooks/useEmailSending';
import useGmailConnection from '../hooks/useGmailConnection';
import useThemeMode from '../hooks/useThemeMode';
import GmailConnectionNotice from './campaign/GmailConnectionNotice';
import useCampaignEditor from '../hooks/useCampaignEditor';
import CampaignLibrary from './CampaignLibrary';
import WorkspaceHeader from './campaign/WorkspaceHeader';
import RecipientsSection from './campaign/RecipientsSection';
import MessageSection from './campaign/MessageSection';
import PersonalizationPanel from './campaign/PersonalizationPanel';
import SendBar from './campaign/SendBar';
import SendActivity from './campaign/SendActivity';
import { downloadLocalLogs } from '../utils/download';
import { loginPath } from '../utils/config';
import './Workspace.css';
import './AppTheme.css';

export default function EmailForm() {
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);
  const [darkMode, setDarkMode] = useThemeMode();
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(
    () => window.matchMedia?.('(min-width: 1101px)').matches ?? true
  );
  const openFields = () => {
    setFieldsOpen(true);
    requestAnimationFrame(() => document.getElementById('fields-panel-toggle')?.focus());
  };
  const gmail = useGmailConnection();
  const { logs, sending, send, cancel, reset, downloadLogs } = useEmailSending(logout);
  const editor = useCampaignEditor({ sending, libraryBusy: libraryBusy || gmail.busy, reset });

  const handleLogout = async () => {
    await cancel();
    logout();
    navigate(loginPath);
  };

  const handleDisconnect = async () => {
    if (
      !window.confirm(
        'Disconnect Gmail? Pending sends will stop and stored Gmail tokens will be removed. A message already in flight may finish. Your saved campaigns and current draft will stay.'
      )
    )
      return;
    if (await gmail.disconnect()) await cancel();
  };

  const handleReconnect = () => {
    if (
      editor.dirty &&
      !window.confirm(
        'Sign in again to reconnect Gmail? Unsaved edits will be lost. Cancel to save your campaign first.'
      )
    )
      return;
    handleLogout();
  };

  const handleSendEmails = async (e) => {
    e.preventDefault();
    if (editor.editorBusy || editor.mappingBlocked || !gmail.status?.connected) return;

    if (!editor.csvFile && !editor.contacts) {
      alert('Please upload a CSV file.');
      return;
    }

    await send({
      csvFile: editor.csvFile,
      uploadId: editor.contacts?.upload_id,
      savedCampaignId: editor.selectedCampaign?.id,
      subject: editor.emailSubject,
      body: editor.emailBody,
      isHtml: editor.isHtml,
      fieldMapping: editor.fieldMapping,
      userEmail: user.email,
    });
  };

  const handleDownloadLogs = async () => {
    try {
      const download = downloadLogs();
      if (download) {
        await download;
        return;
      }
    } catch (error) {
      alert(error.message);
      return;
    }
    downloadLocalLogs(logs);
  };

  return (
    <div className={`mailstorm-theme mailstorm-workspace ${darkMode ? 'workspace-dark' : ''}`}>
      <WorkspaceHeader
        user={user}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        handleLogout={handleLogout}
        libraryBusy={libraryBusy || gmail.busy}
        gmailStatus={gmail.status}
        gmailBusy={gmail.busy}
        handleDisconnect={handleDisconnect}
        handleReconnect={handleReconnect}
        processing={editor.processing}
      />
      <GmailConnectionNotice {...gmail} />
      <CampaignLibrary
        selected={editor.selectedCampaign}
        name={editor.campaignName}
        onName={editor.setCampaignName}
        dirty={editor.dirty}
        disabled={editor.editorBusy}
        onBusy={setLibraryBusy}
        onOpen={editor.loadCampaign}
        onSave={editor.saveCampaign}
        onNew={editor.resetEditor}
        fieldsOpen={fieldsOpen}
        fieldsPanel={
          <PersonalizationPanel
            {...editor.message.personalization}
            emailSubject={editor.emailSubject}
            emailBody={editor.emailBody}
            isHtml={editor.isHtml}
            editorBusy={editor.editorBusy}
            expanded={fieldsOpen}
            setExpanded={setFieldsOpen}
          />
        }
      >
        <form onSubmit={handleSendEmails}>
          <RecipientsSection {...editor.recipients} />
          <MessageSection {...editor.message} openFields={openFields} />
          <SendBar
            user={user}
            sending={sending}
            editorBusy={editor.editorBusy}
            gmailConnected={gmail.status?.connected === true}
            mappingBlocked={editor.mappingBlocked}
            handleReset={editor.handleReset}
            handleCancelSending={cancel}
          />
        </form>
        <SendActivity logs={logs} sending={sending} handleDownloadLogs={handleDownloadLogs} />
      </CampaignLibrary>
    </div>
  );
}
