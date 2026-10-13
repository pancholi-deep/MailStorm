import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/authContext';
import useEmailSending from '../hooks/useEmailSending';
import useCampaignEditor from '../hooks/useCampaignEditor';
import CampaignLibrary from './CampaignLibrary';
import WorkspaceHeader from './campaign/WorkspaceHeader';
import RecipientsSection from './campaign/RecipientsSection';
import MessageSection from './campaign/MessageSection';
import SendBar from './campaign/SendBar';
import SendActivity from './campaign/SendActivity';
import { downloadLocalLogs } from '../utils/download';
import { loginPath } from '../utils/config';
import './Workspace.css';

export default function EmailForm() {
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);
  const [darkMode, setDarkMode] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const { logs, sending, send, cancel, reset, downloadLogs } = useEmailSending(logout);
  const editor = useCampaignEditor({ sending, libraryBusy, reset });

  const handleLogout = async () => {
    await cancel();
    logout();
    navigate(loginPath);
  };

  const handleSendEmails = async (e) => {
    e.preventDefault();
    if (editor.editorBusy) return;

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
    <div className={`mailstorm-workspace ${darkMode ? 'workspace-dark' : ''}`}>
      <WorkspaceHeader
        user={user}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        handleLogout={handleLogout}
        libraryBusy={libraryBusy}
        processing={editor.processing}
      />
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
      >
        <form onSubmit={handleSendEmails}>
          <RecipientsSection {...editor.recipients} />
          <MessageSection {...editor.message} />
          <SendBar
            user={user}
            sending={sending}
            editorBusy={editor.editorBusy}
            handleReset={editor.handleReset}
            handleCancelSending={cancel}
          />
        </form>
        <SendActivity logs={logs} sending={sending} handleDownloadLogs={handleDownloadLogs} />
      </CampaignLibrary>
    </div>
  );
}
