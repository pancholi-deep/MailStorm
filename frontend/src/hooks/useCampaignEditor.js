import { useState, useRef, useEffect } from 'react';
import { validateTemplateContent, inspectCSVContent } from '../utils/validationUtils';
import { inspectUploadedContacts } from '../utils/uploadApi';
import { activeMapping, missingFields } from '../utils/personalization';
import { saveCampaignDraft } from '../services/campaignDraft';

// Owns only the current draft. Library browsing and delivery have separate hooks.
export default function useCampaignEditor({ sending, libraryBusy, reset }) {
  // File states
  const [csvFile, setCsvFile] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [importedTemplateFile, setImportedTemplateFile] = useState(null);
  const [isHtml, setIsHtml] = useState(false);

  // Validation errors
  const [csvError, setCsvError] = useState('');
  const [templateError, setTemplateError] = useState('');

  // Email content states
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  const [showTemplateImport, setShowTemplateImport] = useState(false);
  const [processing, setProcessing] = useState(false);
  const processingLock = useRef(false);

  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignName, setCampaignName] = useState('');
  const [contacts, setContacts] = useState(null);
  const [mapping, setMapping] = useState({});
  const [fieldInfo, setFieldInfo] = useState(null);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState('');
  const [inspectionVersion, setInspectionVersion] = useState(0);
  const fieldMapping = activeMapping(emailSubject, emailBody, mapping);
  const missing = fieldInfo
    ? missingFields(emailSubject, emailBody, fieldMapping, fieldInfo.columns)
    : [];
  const mappingBlocked = fieldsLoading || Boolean(fieldsError) || missing.length > 0;
  useEffect(() => {
    let active = true;
    setFieldInfo(null);
    setFieldsError('');
    if (!csvFile && !contacts) {
      setFieldsLoading(false);
      return;
    }
    setFieldsLoading(true);
    const inspection = csvFile
      ? inspectCSVContent(csvFile)
      : contacts.columns
        ? Promise.resolve(contacts)
        : inspectUploadedContacts(contacts.upload_id);
    inspection
      .then((info) => {
        if (active) setFieldInfo(info);
      })
      .catch((error) => {
        if (active) setFieldsError(error.message);
      })
      .finally(() => {
        if (active) setFieldsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [csvFile, contacts, inspectionVersion]);
  const saveIdentity = useRef(null);

  const csvInputRef = useRef(null);
  const templateInputRef = useRef(null);

  const editorBusy = sending || libraryBusy || processing;
  const dirty = selectedCampaign
    ? Boolean(
        csvFile ||
          contacts?.upload_id !== selectedCampaign.upload_id ||
          campaignName !== selectedCampaign.name ||
          emailSubject !== selectedCampaign.subject ||
          emailBody !== selectedCampaign.body ||
          JSON.stringify(fieldMapping) !==
            JSON.stringify(
              activeMapping(
                selectedCampaign.subject,
                selectedCampaign.body,
                selectedCampaign.field_mapping
              )
            ) ||
          isHtml !== selectedCampaign.is_html
      )
    : Boolean(campaignName || csvFile || emailSubject || emailBody);

  const clearFileInputs = () => {
    for (const input of [csvInputRef, templateInputRef]) {
      if (input.current) input.current.value = '';
    }
  };

  const loadCampaign = (saved) => {
    reset({ forgetIdentity: false });
    setSelectedCampaign(saved);
    setCampaignName(saved.name);
    setContacts({
      upload_id: saved.upload_id,
      filename: saved.filename,
      recipient_count: saved.recipient_count,
    });
    setCsvFile(null);
    setTemplateFile(null);
    setImportedTemplateFile(null);
    setCsvError('');
    setTemplateError('');
    setEmailSubject(saved.subject);
    setEmailBody(saved.body);
    setIsHtml(saved.is_html);
    setMapping(saved.field_mapping || {});
    setShowTemplateImport(false);
    clearFileInputs();
  };

  const saveCampaign = async (copy) => {
    const saved = await saveCampaignDraft({
      campaignName,
      emailSubject,
      emailBody,
      csvFile,
      contacts,
      selectedCampaign,
      isHtml,
      fieldMapping,
      copy,
      saveIdentity,
      onUploaded: (uploaded) => {
        setContacts(uploaded);
        setCsvFile(null);
      },
    });
    setSelectedCampaign(saved);
    setCampaignName(saved.name);
    setContacts({
      upload_id: saved.upload_id,
      filename: saved.filename,
      recipient_count: saved.recipient_count,
      ...(fieldInfo ? { columns: fieldInfo.columns, sample: fieldInfo.sample } : {}),
    });
    return saved;
  };

  // CSV inspection follows file selection; templates are applied explicitly.
  const handleFileChange = (e, type) => {
    if (editorBusy) return;
    const file = e.target.files[0];
    if (!file) return;

    if (type === 'csv') {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        setCsvError('Please upload a valid CSV file.');
        return;
      }
      setCsvError('');
      setCsvFile(file);
      setContacts(null);
    } else if (type === 'template') {
      if (!file.name.toLowerCase().endsWith('.txt') && !file.name.toLowerCase().endsWith('.html')) {
        setTemplateError('Please upload a valid TXT or HTML file.');
        setTemplateFile(null);
        return;
      }
      setTemplateError('');
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
    if (!templateFile) {
      setTemplateError('Choose a TXT or HTML template first.');
      return;
    }
    if (
      (emailSubject || emailBody) &&
      !window.confirm('Replace the current subject and body with this template?')
    )
      return;
    processingLock.current = true;
    setProcessing(true);
    try {
      const template = await validateTemplateContent(templateFile);
      setEmailSubject(template.subject);
      setEmailBody(template.body);
      setIsHtml(template.isHtml);
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
    setSelectedCampaign(null);
    setCampaignName('');
    setContacts(null);
    setMapping({});
    saveIdentity.current = null;
    setShowTemplateImport(false);
    reset();
    setIsHtml(false);
    setCsvFile(null);
    setTemplateFile(null);
    setImportedTemplateFile(null);
    setCsvError('');
    setTemplateError('');
    setEmailSubject('');
    setEmailBody('');

    // Clear file input values so user can upload the same file again
    clearFileInputs();
  };

  const handleReset = () => {
    if (!editorBusy && (!dirty || window.confirm('Discard the unsaved changes in this editor?')))
      resetEditor();
  };

  return {
    csvFile,
    contacts,
    emailSubject,
    emailBody,
    isHtml,
    fieldMapping,
    mappingBlocked,
    processing,
    selectedCampaign,
    campaignName,
    setCampaignName,
    editorBusy,
    dirty,
    loadCampaign,
    saveCampaign,
    resetEditor,
    handleReset,
    recipients: {
      csvFile,
      contacts,
      csvError,
      editorBusy,
      csvInputRef,
      handleFileChange,
      handleFileDrop,
    },
    message: {
      templateFile,
      importedTemplateFile,
      showTemplateImport,
      setShowTemplateImport,
      setTemplateError,
      templateError,
      processing,
      editorBusy,
      templateInputRef,
      handleFileChange,
      handleFileDrop,
      handleProcessFiles,
      emailSubject,
      setEmailSubject,
      emailBody,
      setEmailBody,
      isHtml,
      setIsHtml,
      personalization: {
        fieldInfo,
        fieldsLoading,
        fieldsError,
        fieldMapping,
        missing,
        setMapping,
        retryFields: () => setInspectionVersion((version) => version + 1),
      },
    },
  };
}
