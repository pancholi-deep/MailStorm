import { inspectCSVContent } from '../utils/validationUtils';
import { uploadContacts, inspectUploadedContacts } from '../utils/uploadApi';
import { validateFieldMapping } from '../utils/personalization';
import { createSavedCampaign, overwriteSavedCampaign } from '../utils/campaignLibraryApi';

// Preserve the create identity and successful upload across a failed save/retry.
export async function saveCampaignDraft({
  campaignName,
  emailSubject,
  emailBody,
  csvFile,
  contacts,
  selectedCampaign,
  isHtml,
  fieldMapping = {},
  copy,
  saveIdentity,
  onUploaded,
}) {
  if (!campaignName.trim()) throw new Error('Enter a campaign name.');
  if (!emailSubject.trim() || !emailBody.trim())
    throw new Error('Enter an email subject and body before saving.');
  if (!csvFile && !contacts) throw new Error('Upload a contact CSV before saving.');
  let uploadId = contacts?.upload_id;
  let filename = contacts?.filename;
  const fields = csvFile
    ? await inspectCSVContent(csvFile)
    : contacts?.columns
      ? contacts
      : await inspectUploadedContacts(uploadId);
  validateFieldMapping(emailSubject, emailBody, fieldMapping, fields.columns);
  if (csvFile) {
    uploadId = await uploadContacts(csvFile);
    filename = csvFile.name;
    // Keep a successful upload if saving fails; retry does not upload again.
    onUploaded({
      upload_id: uploadId,
      filename,
      columns: fields.columns,
      sample: fields.sample,
      recipient_count: fields.recipient_count,
    });
  }
  const name =
    copy && campaignName === selectedCampaign?.name
      ? `${campaignName.slice(0, 113)} (copy)`
      : campaignName.trim();
  const values = {
    name,
    upload_id: uploadId,
    filename,
    subject: emailSubject,
    body: emailBody,
    is_html: isHtml,
    field_mapping: fieldMapping,
  };
  let saved;
  if (selectedCampaign && !copy) {
    saved = await overwriteSavedCampaign(selectedCampaign.id, {
      ...values,
      revision: selectedCampaign.revision,
    });
  } else {
    const signature = JSON.stringify(values);
    if (saveIdentity.current?.signature !== signature)
      saveIdentity.current = { signature, id: crypto.randomUUID() };
    saved = await createSavedCampaign({ ...values, id: saveIdentity.current.id });
    saveIdentity.current = null;
  }
  return saved;
}
