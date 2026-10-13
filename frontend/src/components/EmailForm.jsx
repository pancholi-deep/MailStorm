import React, { useState, useRef, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/authContext";
import {
  validateCSVContent,
  validateTemplateContent,
} from "../utils/validationUtils";
import useEmailSending from "../hooks/useEmailSending";
import CampaignLibrary from './CampaignLibrary';
import FileUpload from './FileUpload';
import { uploadContacts } from '../utils/emailApi';
import { createSavedCampaign, overwriteSavedCampaign } from '../utils/campaignLibraryApi';
import { loginPath } from "../utils/config";
import "./Workspace.css";


export default function EmailForm() {
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);

  // File states
  const [csvFile, setCsvFile] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [importedTemplateFile, setImportedTemplateFile] = useState(null);
  const [isHtml, setisHtml] = useState(false);

  // Validation errors
  const [csvError, setCsvError] = useState("");
  const [templateError, setTemplateError] = useState("");

  // Email content states
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  const [showTemplateImport, setShowTemplateImport] = useState(false);
  const [processing, setProcessing] = useState(false);
  const processingLock = useRef(false);

  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignName, setCampaignName] = useState('');
  const [contacts, setContacts] = useState(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const saveIdentity = useRef(null);

  // Sending and logs
  const { logs, sending, send, cancel, reset, downloadLogs } = useEmailSending(logout);
  const csvInputRef = useRef(null);
  const templateInputRef = useRef(null);

  // UI theme
  const [darkMode, setDarkMode] = useState(false);

  const editorBusy = sending || libraryBusy || processing;
  const currentHtml = isHtml;
  const dirty = selectedCampaign
    ? Boolean(csvFile || contacts?.upload_id !== selectedCampaign.upload_id || campaignName !== selectedCampaign.name || emailSubject !== selectedCampaign.subject || emailBody !== selectedCampaign.body || currentHtml !== selectedCampaign.is_html)
    : Boolean(campaignName || csvFile || emailSubject || emailBody);

  const loadCampaign = saved => {
    reset({ forgetIdentity: false });
    setSelectedCampaign(saved);
    setCampaignName(saved.name);
    setContacts({ upload_id: saved.upload_id, filename: saved.filename, recipient_count: saved.recipient_count });
    setCsvFile(null); setTemplateFile(null); setImportedTemplateFile(null);
    setCsvError(''); setTemplateError('');
    setEmailSubject(saved.subject); setEmailBody(saved.body);
    setisHtml(saved.is_html); setShowTemplateImport(false);
    if (csvInputRef.current) csvInputRef.current.value = '';
    if (templateInputRef.current) templateInputRef.current.value = '';
  };

  const saveCampaign = async copy => {
    if (!campaignName.trim()) throw new Error('Enter a campaign name.');
    if (!emailSubject.trim() || !emailBody.trim()) throw new Error('Enter an email subject and body before saving.');
    if (!csvFile && !contacts) throw new Error('Upload a contact CSV before saving.');
    let uploadId = contacts?.upload_id;
    let filename = contacts?.filename;
    if (csvFile) {
      await validateCSVContent(csvFile);
      uploadId = await uploadContacts(csvFile);
      filename = csvFile.name;
      // Keep a successful upload if saving fails; retry does not upload again.
      setContacts({ upload_id: uploadId, filename });
      setCsvFile(null);
    }
    const name = copy && campaignName === selectedCampaign?.name ? `${campaignName.slice(0, 113)} (copy)` : campaignName.trim();
    const values = { name, upload_id: uploadId, filename, subject: emailSubject, body: emailBody, is_html: currentHtml };
    let saved;
    if (selectedCampaign && !copy) {
      saved = await overwriteSavedCampaign(selectedCampaign.id, { ...values, revision: selectedCampaign.revision });
    } else {
      const signature = JSON.stringify(values);
      if (saveIdentity.current?.signature !== signature) saveIdentity.current = { signature, id: crypto.randomUUID() };
      saved = await createSavedCampaign({ ...values, id: saveIdentity.current.id });
      saveIdentity.current = null;
    }
    setSelectedCampaign(saved); setCampaignName(saved.name);
    setContacts({ upload_id: saved.upload_id, filename: saved.filename, recipient_count: saved.recipient_count });
    return saved;
  };

  const handleLogout = async () => {
    await cancel();
    logout();
    navigate(loginPath);
  };

  // When user selects files (just set them, do not parse or validate yet)
  const handleFileChange = (e, type) => {
    if (editorBusy) return;
    const file = e.target.files[0];
    if (!file) return;

    if (type === "csv") {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        setCsvError("Please upload a valid CSV file.");
        setCsvFile(null);
        return;
      }
      setCsvError("");
      setCsvFile(file);
      setContacts(null);
    } else if (type === "template") {
      if (!file.name.toLowerCase().endsWith(".txt") && !file.name.toLowerCase().endsWith(".html")) {
        setTemplateError("Please upload a valid TXT or HTML file.");
        setTemplateFile(null);
        return;
      }
      setTemplateError("");
      setTemplateFile(file);
    }
  };

  // Handle drag and drop for files
  const handleFileDrop = (e, type) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    handleFileChange({ target: { files: [file] } }, type);
  };

  const handleProcessFiles = async () => {
    if (editorBusy || processingLock.current) return;
    setTemplateError('');
    if (!templateFile) { setTemplateError('Choose a TXT or HTML template first.'); return; }
    if ((emailSubject || emailBody) && !window.confirm('Replace the current subject and body with this template?')) return;
    processingLock.current = true;
    setProcessing(true);
    try {
      const template = await validateTemplateContent(templateFile);
      setEmailSubject(template.subject);
      setEmailBody(template.body);
      setisHtml(template.isHtml);
      setImportedTemplateFile(templateFile);
      setShowTemplateImport(false);
    } catch (error) {
      setTemplateError(error.message);
    } finally {
      processingLock.current = false;
      setProcessing(false);
    }
  };

  // Reset all to upload files again
  const resetEditor = () => {
    setSelectedCampaign(null); setCampaignName(''); setContacts(null);
    saveIdentity.current = null;
    setShowTemplateImport(false);
    reset();
    setisHtml(false);
    setCsvFile(null);
    setTemplateFile(null);
    setImportedTemplateFile(null);
    setCsvError("");
    setTemplateError("");
    setEmailSubject("");
    setEmailBody("");

    // Clear file input values so user can upload the same file again
    if (csvInputRef.current) csvInputRef.current.value = "";
    if (templateInputRef.current) templateInputRef.current.value = "";
  };

  const handleReset = () => {
    if (!editorBusy && (!dirty || window.confirm("Discard the unsaved changes in this editor?"))) resetEditor();
  };

  const handleSendEmails = async (e) => {
    e.preventDefault();
    if (editorBusy) return;
  
    if (!csvFile && !contacts) {
      alert("Please upload a CSV file.");
      return;
    }
  
    await send({ csvFile, uploadId: contacts?.upload_id, savedCampaignId: selectedCampaign?.id, subject: emailSubject, body: emailBody, isHtml, userEmail: user.email });
  };

  const handleCancelSending = cancel;

  const handleDownloadLogs = async () => {
    try {
      const download = downloadLogs();
      if (download) { await download; return; }
    } catch (error) { alert(error.message); return; }
    if (logs.length === 0) return;
    const element = document.createElement("a");
    const file = new Blob([logs.join("\n")], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = "email_logs.txt";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(element.href);
  };

  return (
    <div className={`mailstorm-workspace ${darkMode ? 'workspace-dark' : ''}`}>
      <header className="workspace-topbar">
        <div className="workspace-brand"><img src="/mailstorm.png" alt="" /><span>MailStorm</span><span className="brand-divider" /><span className="brand-caption">Mass Mailer</span></div>
        <div className="account-actions"><span className="account-name">{user?.name}</span><button type="button" className="ws-button theme-button" onClick={() => setDarkMode(!darkMode)} aria-label="Toggle dark mode" aria-pressed={darkMode}>{darkMode ? '☀' : '☾'}</button><button type="button" className="ws-button" onClick={handleLogout} disabled={libraryBusy || processing}>Sign Out</button></div>
      </header>
      <CampaignLibrary selected={selectedCampaign} name={campaignName} onName={setCampaignName}
        dirty={dirty} disabled={editorBusy} onBusy={setLibraryBusy} onOpen={loadCampaign}
        onSave={saveCampaign} onNew={resetEditor}>
        <form onSubmit={handleSendEmails}>
          <section className="composer-section" aria-labelledby="recipients-heading">
            <div className="section-heading"><span className="step-number">01</span><div><h2 id="recipients-heading">Recipients</h2><p className="muted">Choose who you want to reach.</p></div>{contacts && <span className="ready-badge">Ready to reuse</span>}</div>
            <FileUpload
              id="csv-upload" label={contacts ? 'Replace contact CSV (optional)' : 'Upload CSV'}
              filename={csvFile?.name || contacts?.filename} status={contacts ? 'Saved file' : 'Selected file'}
              description={contacts ? `${contacts.recipient_count != null ? contacts.recipient_count.toLocaleString() + ' contacts · ' : ''}Saved with this campaign` : csvFile ? 'CSV selected · checked when you save or send' : 'Drop a CSV here, or choose a file to get started.'}
              accept=".csv" disabled={editorBusy} inputRef={csvInputRef}
              onChange={e => handleFileChange(e, 'csv')} onDrop={e => handleFileDrop(e, 'csv')}
              chooseLabel="Choose CSV" replaceLabel="Replace CSV"
            />
            <p className="field-help muted">CSV must include <code>name</code> and <code>email</code> columns.</p>
            {csvError && <p role="alert" className="workspace-error">{csvError}</p>}
          </section>

          <section className="composer-section" aria-labelledby="message-heading">
            <div className="section-heading"><span className="step-number">02</span><div><h2 id="message-heading">Message</h2><p className="muted">Make every email feel personal.</p></div><button type="button" className="ws-button import-toggle" disabled={editorBusy} aria-expanded={showTemplateImport} aria-controls="template-import" onClick={() => { setShowTemplateImport(!showTemplateImport); setTemplateError(''); }}>{showTemplateImport ? 'Close import' : 'Import template'}</button></div>
            {(showTemplateImport || templateFile) && <div id="template-import" className="template-import">
              <FileUpload
                id="template-upload" label="Upload Template" filename={templateFile?.name}
                status={templateFile === importedTemplateFile ? 'Imported file' : 'Selected file'}
                description={templateFile ? (templateFile === importedTemplateFile ? 'Imported into the subject and body below.' : 'Ready to import · choose Use template to apply it.') : 'Drop a TXT or HTML file here, or choose a template.'}
                accept=".txt,.html" disabled={editorBusy} inputRef={templateInputRef}
                onChange={e => { handleFileChange(e, 'template'); setShowTemplateImport(true); }}
                onDrop={e => { handleFileDrop(e, 'template'); if (!editorBusy) setShowTemplateImport(true); }}
                chooseLabel="Choose template" replaceLabel="Replace template"
              />
              {showTemplateImport && <div className="template-import-actions">
                <details className="template-help"><summary>Template format</summary><p>TXT</p><pre>{'Subject: Hello {name}\nBody: Your message here'}</pre><p>HTML</p><pre>{'<!-- Subject: Hello {name} -->\n<p>Your message here</p>'}</pre></details>
                <button type="button" className="ws-button secondary" disabled={editorBusy || !templateFile} onClick={handleProcessFiles}>{processing ? 'Importing…' : 'Use template'}</button>
              </div>}
              {templateError && <p role="alert" className="workspace-error">{templateError}</p>}
            </div>}
            <label className="field-label" htmlFor="email-subject">Email Subject</label><input id="email-subject" className="ws-input subject-input" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} disabled={editorBusy} placeholder="A subject worth opening" required />
            <div className="body-label-row"><label className="field-label" htmlFor="email-body">Email Body</label><label className="html-switch"><input type="checkbox" checked={isHtml} disabled={editorBusy} onChange={e => setisHtml(e.target.checked)} />Email body contains HTML</label></div>
            <textarea id="email-body" className={`ws-input message-body ${isHtml ? 'html-body' : ''}`} value={emailBody} onChange={e => setEmailBody(e.target.value)} disabled={editorBusy} placeholder={'Hi {name},\n\nLet’s start a conversation…'} required rows={9} />
            <div className="message-hint"><span>Personalize with <code>{'{name}'}</code> and <code>{'{email}'}</code>.</span><span>{isHtml ? 'HTML source' : 'Plain text'}</span></div>
          </section>

          <div className="send-bar"><div className="sender-info"><span className="sender-avatar" aria-hidden="true">{(user?.name || 'M').slice(0, 1).toUpperCase()}</span><div><span className="muted">Sending from</span><strong>{user?.email}</strong></div></div><div className="send-actions">{sending ? <button type="button" className="ws-button" onClick={handleCancelSending}>Cancel Sending</button> : <button type="button" className="ws-button" disabled={editorBusy} onClick={handleReset}>Reset</button>}<button type="submit" className="ws-button primary send-button" disabled={editorBusy}>{sending ? 'Sending…' : 'Send Emails'}<span aria-hidden="true">↗</span></button></div></div>
        </form>
        <section className="activity-section" aria-labelledby="activity-heading"><div className="activity-heading"><h2 id="activity-heading"><span className={`activity-dot ${sending ? 'is-active' : ''}`} />Send activity</h2>{logs.length > 0 && <button type="button" className="ws-button" onClick={handleDownloadLogs}>Download Logs</button>}</div><div className={`activity-log ${logs.length ? 'has-logs' : ''}`} role="log" aria-label="Delivery logs" aria-live="polite" aria-relevant="additions" tabIndex={0}>{logs.length ? logs.map((log, idx) => <p key={idx}>{log}</p>) : <p>When you send, delivery updates will appear here.</p>}</div></section>
      </CampaignLibrary>
    </div>
  );
}
