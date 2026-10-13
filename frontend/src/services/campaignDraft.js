import { validateCSVContent } from '../utils/validationUtils';
import { uploadContacts } from '../utils/uploadApi';
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
  if (csvFile) {
    await validateCSVContent(csvFile);
    uploadId = await uploadContacts(csvFile);
    filename = csvFile.name;
    // Keep a successful upload if saving fails; retry does not upload again.
    onUploaded({ upload_id: uploadId, filename });
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
