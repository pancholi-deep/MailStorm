import React, { useEffect, useState, useRef, useContext } from "react";
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../AuthContext'; // Adjust the path if needed

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
  const eventSourceRef = useRef(null);
  const abortControllerRef = useRef(null); // Added for aborting fetch

  useEffect(() => {
    if (!user) {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        setUser(JSON.parse(storedUser));
      }
    }
  }, [user, setUser]);  

  const handleLogout = () => {
    logout(); 
    navigate('/login');
  };

  const personalEmailDomains = [
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "icloud.com",
    "aol.com",
    "mail.com",
  ];

  const validateEmail = (email) => {
    email = email.toLowerCase();
    return personalEmailDomains.some((domain) => email.endsWith("@" + domain));
  };

  // Utility to read text content from a file (returns Promise<string>)
  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  const validateCSVContent = async (file) => {
    try {
      const text = await readFileAsText(file);
      const lines = text.trim().split(/\r?\n/);
      if (lines.length === 0) throw new Error("CSV file is empty");
  
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      if (!headers.includes("name") || !headers.includes("email")) {
        throw new Error("CSV must contain 'name' and 'email' columns");
      }
  
      const nameIndex = headers.indexOf("name");
      const emailIndex = headers.indexOf("email");
  
      // Validate emails in rows (skip header)
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        // Skip row if name or email is empty or missing
        const name = cols[nameIndex]?.trim() || "";
        const email = cols[emailIndex]?.trim() || "";
        if (name === "" || email === "") {
          // Skip this row silently
          continue;
        }
        if (!validateEmail(email)) {
          throw new Error(`Invalid personal email at row ${i + 1}: ${email}`);
        }
      }
      setCsvError("");
      return true;
    } catch (error) {
      setCsvError(error.message);
      setCsvFile(null);
      return false;
    }
  };  

  const validateTemplateContent = async (file) => {
    try {
      const text = await readFileAsText(file);
      const lowerText = text.toLowerCase();
      if (!lowerText.includes("subject:")) {
        throw new Error("Template must contain a 'Subject:' line");
      }
      if (!lowerText.includes("body:")) {
        throw new Error("Template must contain a 'Body:' line");
      }
      setTemplateError("");
      return true;
    } catch (error) {
      setTemplateError(error.message);
      setTemplateFile(null);
      return false;
    }
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
      // Validate CSV content
      const valid = await validateCSVContent(file);
      if (valid) {
        setCsvFile(file);
      }
    } else if (type === "template") {
      if (!file.name.endsWith(".txt")) {
        setTemplateError("Please upload a valid TXT file.");
        setTemplateFile(null);
        return;
      }
      // Validate template content
      const valid = await validateTemplateContent(file);
      if (valid) {
        setTemplateFile(file);
      }
    }
  };

  const handleFileDrop = (e, type) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    // create a synthetic event to reuse handleFileChange logic
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
    if (eventSourceRef.current) eventSourceRef.current.close();

    // Create a new AbortController instance for each request
    abortControllerRef.current = new AbortController();

    const formData = new FormData();
    formData.append("csv_file", csvFile);
    formData.append("template_file", templateFile);

    try {
      const response = await fetch("http://localhost:8000/send-emails", {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal, // pass abort signal here
      });

      if (!response.ok) {
        const errorText = await response.text();
        setLogs((logs) => [...logs, `Error: ${errorText}`]);
        setSending(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let lines = buffer.split("\n\n");
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

  // New handler to cancel sending
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

          <div className="p-8">
            <h1 className="text-2xl font-bold">Welcome, {user?.name}</h1>
            <p>Email: {user?.email}</p>
            <button
              className="mt-4 bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded"
              onClick={handleLogout}
            >
              Sign Out
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSendEmails} className="space-y-5">
            {/* CSV Upload */}
            <div className="space-y-2">
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
                  text-white`}
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
