import React, { useState, useRef, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/authContext";
import {
  validateCSVContent,
  validateTemplateContent,
} from "../utils/validationUtils";
import useEmailSending from "../hooks/useEmailSending";
import { loginPath } from "../utils/config";


export default function EmailForm() {
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);

  // File states
  const [csvFile, setCsvFile] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [isHtml, setisHtml] = useState(false);

  // Validation errors
  const [csvError, setCsvError] = useState("");
  const [templateError, setTemplateError] = useState("");

  // Email content states
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  // Control flow state
  const [filesProcessed, setFilesProcessed] = useState(false);

  // Sending and logs
  const { logs, sending, send, cancel, reset, downloadLogs } = useEmailSending(logout);
  const csvInputRef = useRef(null);
  const templateInputRef = useRef(null);

  // UI theme
  const [darkMode, setDarkMode] = useState(false);

  const [manualEntryMode, setManualEntryMode] = useState(false);

  const handleLogout = async () => {
    await cancel();
    logout();
    navigate(loginPath);
  };

  // When user selects files (just set them, do not parse or validate yet)
  const handleFileChange = (e, type) => {
    if (sending) return;
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

  // Validate and process files only after user clicks the button
  const handleProcessFiles = async () => {
    setCsvError("");
    setTemplateError("");
    if (!csvFile) { setCsvError("Please upload a CSV file."); return; }
    if (!templateFile) { setTemplateError("Please upload a Template TXT file."); return; }
    try {
      await validateCSVContent(csvFile);
    } catch (error) {
      setCsvError(error.message);
      return;
    }
    try {
      const template = await validateTemplateContent(templateFile);
      setEmailSubject(template.subject);
      setEmailBody(template.body);
      setisHtml(template.isHtml);
      setFilesProcessed(true);
    } catch (error) {
      setTemplateError(error.message);
    }
  };

  // Reset all to upload files again
  const handleReset = () => {
    if (sending) return;
    reset();
    setisHtml(false);
    setCsvFile(null);
    setTemplateFile(null);
    setCsvError("");
    setTemplateError("");
    setEmailSubject("");
    setEmailBody("");
    setFilesProcessed(false);

    // Clear file input values so user can upload the same file again
    if (csvInputRef.current) csvInputRef.current.value = "";
    if (templateInputRef.current) templateInputRef.current.value = "";
  };

  const handleSendEmails = async (e) => {
    e.preventDefault();
  
    if (!csvFile) {
      alert("Please upload a CSV file.");
      return;
    }
  
    if (!manualEntryMode && !templateFile) {
      alert("Please upload a template file or switch to manual entry.");
      return;
    }
  
    await send({ csvFile, subject: emailSubject, body: emailBody, isHtml: manualEntryMode ? false : isHtml, userEmail: user.email });
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
    <div className={`${darkMode ? "dark" : ""}`}>
      <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-100 transition-colors">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-blue-600 dark:text-blue-400">MailStorm</span>
              <span className="ml-2 text-gray-600 dark:text-gray-300 text-base font-normal">
                Mass Mailer
              </span>
            </h1>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="rounded-full p-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition"
              aria-label="Toggle dark mode"
            >
              {darkMode ? "🌙" : "☀️"}
            </button>
          </div>
          <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold">👋 Welcome, {user?.name}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Email: {user?.email}
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md transition bg-red-500 hover:bg-red-600 text-white"
            onClick={handleLogout}
          >
            Sign Out
          </button>
        </div>

          {/* ✅ CSV Upload - always needed */}
          {!filesProcessed && (
            <div className="space-y-4 mb-4">
              <label htmlFor="csv-upload" className="block text-sm font-medium">
                Upload CSV
              </label>
              <label
                htmlFor="csv-upload"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleFileDrop(e, "csv")}
                className={`w-full flex flex-col items-center justify-center border-2 border-dashed rounded-md p-4 cursor-pointer transition-colors duration-200 text-sm
                  ${csvError ? "border-red-500" : "border-gray-300 dark:border-gray-600"}
                  bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700`}
              >
                {csvFile ? (
                  <div className="text-center">
                    <p className="text-xs text-green-600 dark:text-green-400">
                      {csvFile.name} ({(csvFile.size / 1024).toFixed(2)} KB)
                    </p>
                  </div>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-300">
                    Drag & drop or click
                  </span>
                )}
              </label>
              <input
                id="csv-upload"
                type="file"
                accept=".csv"
                className="sr-only"
                onChange={(e) => handleFileChange(e, "csv")}
                ref={csvInputRef}
              />
              {csvError && <p role="alert" className="text-xs text-red-500">{csvError}</p>}
            </div>
          )}

          <br/>
          {/* ℹ️ Info box about composing options */}
          <div className="mb-2 p-3 rounded-md bg-blue-50 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-sm border border-blue-200 dark:border-blue-700">
            You can choose to either <strong>upload a TXT/HTML template</strong> with the email subject and body, or <strong>compose the message manually</strong> using the toggle below.
          </div>

          {/* ✅ Toggle manual entry mode */}
          <div className="flex items-center justify-left mb-4">
            <label className="text-sm mr-2">✏️ Compose Manually</label>
            <button
              type="button"
              onClick={() => { if (!sending) setManualEntryMode(!manualEntryMode); }}
              aria-pressed={manualEntryMode}
              className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-medium 
                ${manualEntryMode ? "bg-green-600 text-white" : "bg-gray-300 dark:bg-gray-700 text-black dark:text-white"} 
                transition`}
            >
              {manualEntryMode ? "On" : "Off"}
            </button>
          </div>
          {manualEntryMode && (
            <div className="mb-6 p-4 rounded-lg border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-100 shadow-sm">
              <div className="flex items-start space-x-2">
                <span className="text-xl">💡</span>
                <div className="text-sm leading-relaxed">
                  <p className="font-semibold mb-1">Compose Manually Mode is enabled</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>
                      You can write your own <span className="font-medium">email subject and body</span> below.
                    </li>
                    <li>
                      Use <code className="bg-white dark:bg-gray-800 px-1 rounded">{`{name}`}</code> placeholders to personalize email subject and body.
                    </li>
                    <li>
                      For example:<code className="bg-white dark:bg-gray-800 px-1 rounded">{`{name}`}</code>placeholders will be replaced with values from 'name' column of your uploaded CSV.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ✅ File upload mode */}
          {!manualEntryMode && !filesProcessed && (
            <>
              {/* Template Upload */}
              <div className="space-y-2 mb-4">
                <label htmlFor="template-upload" className="block text-sm font-medium">
                  Upload Template
                </label>
                <label
                  htmlFor="template-upload"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleFileDrop(e, "template")}
                  className={`w-full flex flex-col items-center justify-center border-2 border-dashed rounded-md p-4 cursor-pointer transition-colors duration-200 text-sm
                    ${templateError ? "border-red-500" : "border-gray-300 dark:border-gray-600"}
                    bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700`}
                >
                  {templateFile ? (
                    <div className="text-center">
                      <p className="text-xs text-green-600 dark:text-green-400">
                        {templateFile.name} ({(templateFile.size / 1024).toFixed(2)} KB)
                      </p>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-gray-300">
                      Drag & drop or click
                    </span>
                  )}
                </label>
                <input
                  id="template-upload"
                  type="file"
                  accept=".txt,.html"
                  className="sr-only"
                  onChange={(e) => handleFileChange(e, "template")}
                  ref={templateInputRef}
                />
                {templateError && <p role="alert" className="text-xs text-red-500">{templateError}</p>}
              </div>

              <div className="flex space-x-2 mb-4">
                <button
                  onClick={handleProcessFiles}
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white 
                    bg-blue-600 hover:bg-blue-700 rounded-md transition"
                  disabled={!csvFile || !templateFile}
                >
                  Process Files
                </button>
                {(csvFile || templateFile) && (
                  <button
                    onClick={handleReset}
                    className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white 
                      bg-gray-400 hover:bg-gray-500 rounded-md transition"
                  >
                    Reset
                  </button>
                )}
              </div>
            </>
          )}

          {/* ✅ Manual Entry or Processed Form */}
          {(manualEntryMode || filesProcessed || sending) && (
            <form onSubmit={handleSendEmails} className="space-y-4 mb-6">
              {/* Subject */}
              <div className="space-y-2">
                <label htmlFor="email-subject" className="block text-sm font-medium">
                  Email Subject
                </label>
                <input
                  id="email-subject"
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Enter email subject"
                  className={`w-full border-2 border-dashed rounded-md p-4 text-sm transition-colors duration-200 
                    border-gray-300 dark:border-gray-600 
                    bg-white dark:bg-gray-800 
                    hover:bg-gray-50 dark:hover:bg-gray-700 
                    text-gray-800 dark:text-white`}
                  required
                />
              </div>

              {/* Body */}
              <div className="space-y-2">
                <label htmlFor="email-body" className="block text-sm font-medium">
                  Email Body
                </label>
                <textarea
                  id="email-body"
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={8}
                  placeholder="Enter email body"
                  className={`w-full border-2 border-dashed rounded-md p-4 text-sm transition-colors duration-200 
                    border-gray-300 dark:border-gray-600 
                    bg-white dark:bg-gray-800 
                    hover:bg-gray-50 dark:hover:bg-gray-700 
                    text-gray-800 dark:text-white`}
                  required
                />
              </div>

              <div className="flex space-x-4">
                <button
                  type="submit"
                  disabled={sending}
                  className={`inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md text-white
                    ${sending ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}
                >
                  {sending ? "Sending..." : "Send Emails"}
                </button>

                {sending && (
                  <button
                    type="button"
                    onClick={handleCancelSending}
                    className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md bg-red-600 hover:bg-red-700 text-white"
                  >
                    Cancel
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleReset}
                  disabled={sending}
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md bg-gray-400 hover:bg-gray-500 text-white"
                >
                  Reset
                </button>
              </div>
            </form>
          )}

          {/* Logs Section */}
          <div className="mt-8 bg-gray-50 dark:bg-gray-900 rounded-md p-4 max-h-64 overflow-auto">
            <h2 className="text-lg font-semibold mb-2">Logs</h2>
            <div className="text-xs font-mono whitespace-pre-wrap" role="log" aria-live="polite" aria-relevant="additions">
              {logs.length === 0 ? (
                <p className="text-gray-400 italic">No logs yet.</p>
              ) : (
                logs.map((log, index) => <p key={index}>{log}</p>)
              )}
            </div>
          </div>

          {/* Download Logs Button */}
          {logs.length > 0 && (
            <button
              onClick={handleDownloadLogs}
              className="mt-3 px-4 py-2 bg-gray-300 dark:bg-gray-700 hover:bg-gray-400 dark:hover:bg-gray-600 rounded-md text-sm"
            >
              Download Logs
            </button>
          )}
        </div>
        </div>

        <footer className="text-center mt-4 mb-6 text-sm text-gray-500 dark:text-gray-400">
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Privacy Policy
          </a>
        </footer>
      </div>
  );
}
