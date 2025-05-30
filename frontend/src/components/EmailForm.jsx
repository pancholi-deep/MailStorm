import React, { useEffect, useState, useRef, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/authContext";
import {
  validateCSVContent,
  validateTemplateContent,
} from "../utils/validationUtils";
import { readFileAsText } from "../utils/fileUtils";

const backendURL = process.env.REACT_APP_BACKEND_URL;
const loginEndPoint = process.env.REACT_APP_LOGIN_ENDPOINT;
const sendEmailsEndPoint = process.env.REACT_APP_SENDEMAIL_ENDPOINT;

export default function EmailForm() {
  const navigate = useNavigate();
  const { user, setUser, logout } = useContext(AuthContext);

  // File states
  const [csvFile, setCsvFile] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [isHtml, setisHtml] = useState(null);

  // Validation errors
  const [csvError, setCsvError] = useState("");
  const [templateError, setTemplateError] = useState("");

  // Email content states
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  // Control flow state
  const [filesProcessed, setFilesProcessed] = useState(false);

  // Sending and logs
  const [logs, setLogs] = useState([]);
  const [sending, setSending] = useState(false);
  const abortControllerRef = useRef(null);
  const csvInputRef = useRef(null);
  const templateInputRef = useRef(null);

  // UI theme
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    if (!user) {
      const storedUser = localStorage.getItem("user");
      if (storedUser) setUser(JSON.parse(storedUser));
    }
  }, [user, setUser]);

  const handleLogout = () => {
    logout();
    navigate(loginEndPoint);
  };

  // When user selects files (just set them, do not parse or validate yet)
  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    if (type === "csv") {
      if (!file.name.endsWith(".csv")) {
        setCsvError("Please upload a valid CSV file.");
        setCsvFile(null);
        return;
      }
      setCsvError("");
      setCsvFile(file);
    } else if (type === "template") {
      if (!file.name.endsWith(".txt") && !file.name.endsWith(".html")) {
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
    const isHtml = templateFile.name.endsWith(".html");
    const content = await readFileAsText(templateFile);

    if (isHtml) {
      setEmailSubject(""); // optionally extract from <title> or leave empty
      setEmailBody(content);
      setisHtml(isHtml);
    } else {
      const lines = content.trim().split("\n");
    
      let subject = "";
      let bodyLines = [];
    
      const subjectLineIndex = lines.findIndex((line) =>
        line.toLowerCase().startsWith("subject:")
      );
      const bodyLineIndex = lines.findIndex((line) =>
        line.toLowerCase().startsWith("body:")
      );
    
      if (subjectLineIndex !== -1) {
        subject = lines[subjectLineIndex].substring(8).trim();
      }
    
      if (bodyLineIndex !== -1) {
        bodyLines = lines.slice(bodyLineIndex + 1);
      } else if (subjectLineIndex !== -1) {
        bodyLines = lines.slice(subjectLineIndex + 1);
      } else {
        bodyLines = lines;
      }
    
      const body = bodyLines.join("\n").trim();
      setEmailSubject(subject);
      setEmailBody(body);
    }

    setCsvError("");
    setTemplateError("");

    if (!csvFile) {
      setCsvError("Please upload a CSV file.");
      return;
    }
    if (!templateFile) {
      setTemplateError("Please upload a Template TXT file.");
      return;
    }

    try {
      // Validate CSV content
      await validateCSVContent(csvFile, readFileAsText);
    
      // Read template content as text
      const content = await readFileAsText(templateFile);
    
      // Validate template content
      await validateTemplateContent(templateFile, () => content);
    
      // Try to extract subject from HTML comment first
      const subjectMatch = content.match(/<!--\s*Subject:\s*(.*?)\s*-->/i);
    
      let subject = "";
      let bodyLines = [];
    
      if (subjectMatch) {
        // Subject found in HTML comment
        subject = subjectMatch[1].trim();
    
        // Remove the subject comment line from body to avoid duplication
        // Split by lines, filter out the subject comment line
        const lines = content
          .split("\n")
          .filter(line => !line.match(/<!--\s*Subject:/i));
    
        bodyLines = lines;
      } else {
        // No HTML comment subject found — fallback to parsing text lines
    
        // Split content by lines (trimmed)
        const lines = content.trim().split("\n");
    
        // Find line starting with "subject:"
        const subjectLineIndex = lines.findIndex(line =>
          line.toLowerCase().startsWith("subject:")
        );
        // Find line starting with "body:"
        const bodyLineIndex = lines.findIndex(line =>
          line.toLowerCase().startsWith("body:")
        );
    
        if (subjectLineIndex !== -1) {
          subject = lines[subjectLineIndex].substring(8).trim();
        }
    
        if (bodyLineIndex !== -1) {
          bodyLines = lines.slice(bodyLineIndex + 1);
        } else if (subjectLineIndex !== -1) {
          bodyLines = lines.slice(subjectLineIndex + 1);
        } else {
          bodyLines = lines;
        }
      }
    
      // Join body lines back into a single string
      const body = bodyLines.join("\n").trim();
    
      setEmailSubject(subject);
      setEmailBody(body);
    
      // Mark files as processed — show subject/body fields and hide uploaders
      setFilesProcessed(true);
    } catch (err) {
      // If error is from CSV validation
      if (err.message.includes("CSV")) {
        setCsvError(err.message);
      } else {
        setTemplateError(err.message);
      }
    }
  };

  // Reset all to upload files again
  const handleReset = () => {
    setCsvFile(null);
    setTemplateFile(null);
    setCsvError("");
    setTemplateError("");
    setEmailSubject("");
    setEmailBody("");
    setFilesProcessed(false);
    setLogs([]);

    // Clear file input values so user can upload the same file again
    if (csvInputRef.current) csvInputRef.current.value = "";
    if (templateInputRef.current) templateInputRef.current.value = "";
  };

  const handleSendEmails = async (e) => {
    e.preventDefault();
    if (!csvFile || !templateFile) {
      alert("Please upload both CSV and Template files.");
      return;
    }

    setLogs([]);
    setSending(true);
    abortControllerRef.current = new AbortController();

    const formData = new FormData();
    formData.append("email", user.email);
    formData.append("csv_file", csvFile);
    formData.append("email_subject", emailSubject);
    formData.append("email_body", emailBody);
    formData.append("isHtml", isHtml ? "true" : "false");

    try {
      const accessToken = localStorage.getItem("access_token");
      const response = await fetch(`${backendURL}${sendEmailsEndPoint}`, {
        method: "POST",
        body: formData,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        setLogs((prev) => [...prev, `Error: ${errorText}`]);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const logLine = line.replace("data: ", "").trim();
            setLogs((prev) => [...prev, logLine]);
          }
        }
      }
    } catch (error) {
      if (error.name === "AbortError") {
        setLogs((logs) => [...logs, "Sending cancelled by user."]);
      } else {
        setLogs((logs) => [...logs, `Error: ${error.message}`]);
      }
    } finally {
      setSending(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelSending = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setSending(false);
    }
  };

  const handleDownloadLogs = () => {
    if (logs.length === 0) return;
    const element = document.createElement("a");
    const file = new Blob([logs.join("\n")], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = "email_logs.txt";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className={`${darkMode ? "dark" : ""}`}>
      <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-100 transition-colors">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-blue-600 dark:text-blue-400">EmailBlast</span>
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
          <div className="space-y-2 mb-6">
            <h1 className="text-lg font-bold">Welcome, {user?.name}</h1>
            <h1 className="text-sm">Email: {user?.email}</h1>
            <button
              className={`inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md transition bg-red-500 hover:bg-red-600
                text-white py-2 px-4 rounded`}
              onClick={handleLogout}
            >
              Sign Out
            </button>
          </div>

          {/* Upload Files or Show Email Form */}
          {!filesProcessed ? (
            <>
              <div className="flex space-x-6 mb-4">
                {/* CSV Upload */}
                <div className="flex-1 space-y-2">
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
                      <>
                        <span className="text-xs text-gray-500 dark:text-gray-300">
                          Drag & drop or click
                        </span>
                      </>
                    )}
                  </label>
                  <input
                    id="csv-upload"
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => handleFileChange(e, "csv")}
                    ref={csvInputRef}
                  />
                  {csvError && <p className="text-xs text-red-500">{csvError}</p>}
                </div>

                {/* Template Upload */}
                <div className="flex-1 space-y-2">
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
                      <>
                        <span className="text-xs text-gray-500 dark:text-gray-300">
                          Drag & drop or click
                        </span>
                      </>
                    )}
                  </label>
                  <input
                    id="template-upload"
                    type="file"
                    accept=".txt,.html"
                    className="hidden"
                    onChange={(e) => handleFileChange(e, "template")}
                    ref={templateInputRef}
                  />
                  {templateError && <p className="text-xs text-red-500">{templateError}</p>}
                </div>
              </div>

              <div className="flex space-x-2">
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
          ) : (
            <>
              {/* Email Subject and Body Editing */}
              <form onSubmit={handleSendEmails} className="space-y-4 mb-6">
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

              {/* Email Body */}
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
                    bg-gray-400 hover:bg-gray-500 rounded-md transition
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
            </>
          )}

          {/* Logs Section */}
          <div className="mt-8 bg-gray-50 dark:bg-gray-900 rounded-md p-4 max-h-64 overflow-auto">
            <h2 className="text-lg font-semibold mb-2">Logs</h2>
            <div className="text-xs font-mono whitespace-pre-wrap">
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
    </div>
  );
}
