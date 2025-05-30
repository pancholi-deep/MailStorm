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
  const [csvFile, setCsvFile] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [csvError, setCsvError] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [logs, setLogs] = useState([]);
  const [sending, setSending] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const abortControllerRef = useRef(null);

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

  const handleFileChange = async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    if (type === "csv") {
      if (!file.name.endsWith(".csv")) {
        setCsvError("Please upload a valid CSV file.");
        setCsvFile(null);
        return;
      }
      try {
        await validateCSVContent(file, readFileAsText);
        setCsvFile(file);
        setCsvError("");
      } catch (err) {
        setCsvError(err.message);
        setCsvFile(null);
      }
    }

    if (type === "template") {
      if (!file.name.endsWith(".txt")) {
        setTemplateError("Please upload a valid TXT file.");
        setTemplateFile(null);
        return;
      }
      try {
        await validateTemplateContent(file, readFileAsText);
        setTemplateFile(file);
        setTemplateError("");
      } catch (err) {
        setTemplateError(err.message);
        setTemplateFile(null);
      }
    }
  };

  const handleFileDrop = (e, type) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    handleFileChange({ target: { files: [file] } }, type);
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
    formData.append("template_file", templateFile);

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
          <div className="space-y-2">
            <h1 className="text-lg font-bold">Welcome, {user?.name}</h1>
            <h1 className="text-sm">Email: {user?.email}</h1>
            <button
              className={`inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md transition
                ${sending ? "bg-gray-400 cursor-not-allowed" : "bg-red-500 hover:bg-red-600"}
                text-white py-2 px-4 rounded`}
              onClick={handleLogout}
            >
              Sign Out
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSendEmails} className="space-y-5">
            {/* CSV Upload */}
            <div className="space-y-2">
              <br/>
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
                <span className="text-xs text-gray-500 dark:text-gray-300">Drag & drop or click</span>
                <span className="mt-1 font-medium">CSV File</span>
              </label>
              <input
                id="csv-upload"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => handleFileChange(e, "csv")}
              />
              {csvFile && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  {csvFile.name} ({(csvFile.size / 1024).toFixed(2)} KB)
                </p>
              )}
              {csvError && <p className="text-xs text-red-500">{csvError}</p>}
            </div>

            {/* Template Upload */}
            <div className="space-y-2">
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
                <span className="text-xs text-gray-500 dark:text-gray-300">Drag & drop or click</span>
                <span className="mt-1 font-medium">TXT File</span>
              </label>
              <input
                id="template-upload"
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e) => handleFileChange(e, "template")}
              />
              {templateFile && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  {templateFile.name} ({(templateFile.size / 1024).toFixed(2)} KB)
                </p>
              )}
              {templateError && <p className="text-xs text-red-500">{templateError}</p>}
            </div>

            {/* Submit and Cancel Buttons */}
            <div className="flex space-x-4">
              <button
                type="submit"
                disabled={sending}
                className={`inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md transition
                  ${sending ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}
                  text-white py-2 px-4 rounded`}
              >
                {sending ? "Sending..." : "Send Emails"}
              </button>

              {sending && (
                <button
                  type="button"
                  onClick={handleCancelSending}
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md bg-red-600 hover:bg-red-700 text-white transition"
                >
                  Cancel Sending
                </button>
              )}
            </div>
          </form>

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
