import { useCallback, useEffect, useRef, useState } from 'react';
import {
  sendEmails,
  cancelCampaign,
  listCampaigns,
  observeCampaign,
  downloadCampaignLogs,
} from '../utils/emailApi';
import { inspectCSVContent } from '../utils/validationUtils';
import {
  forgetBatch,
  getBatchIdentity,
  getUploadBatchIdentity,
  rememberReusableSend,
  finishReusableSend,
} from '../utils/batchUtils';

export default function useEmailSending(logout) {
  const [logs, setLogs] = useState([]);
  const [sending, setSending] = useState(false);
  const controllerRef = useRef(null);
  const batchRef = useRef(null);
  const campaignRef = useRef(null);
  const cancelRequestedRef = useRef(false);
  const mountedRef = useRef(true);

  const appendLog = useCallback((message) => {
    if (mountedRef.current) setLogs((previous) => [...previous, message].slice(-500));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    listCampaigns()
      .then((jobs) => {
        if (!mountedRef.current || controllerRef.current) return;
        jobs
          .filter((item) => item.state === 'complete')
          .forEach((item) => finishReusableSend(item.id));
        const job = jobs.find((item) =>
          ['importing', 'queued', 'running', 'retry_wait'].includes(item.state)
        );
        if (!job) return;
        campaignRef.current = job.id;
        const controller = new AbortController();
        controllerRef.current = controller;
        setSending(true);
        setLogs(['Reconnected to your running campaign.']);
        observeCampaign(job.id, {
          signal: controller.signal,
          onEvent: (event) => {
            appendLog(event.message);
          },
        })
          .then((result) => {
            if (result?.state === 'complete') finishReusableSend(job.id);
          })
          .catch((error) => {
            if (error.name !== 'AbortError') appendLog(error.message);
          })
          .finally(() => {
            if (controllerRef.current === controller) controllerRef.current = null;
            if (mountedRef.current) setSending(false);
          });
      })
      .catch(() => {
        /* Sign-in and explicit sends report session failures. */
      });
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [appendLog]);

  const send = async ({
    csvFile,
    uploadId,
    savedCampaignId,
    subject,
    body,
    isHtml,
    userEmail,
    fieldMapping = {},
  }) => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    campaignRef.current = null;
    cancelRequestedRef.current = false;
    setSending(true);
    setLogs([]);
    let expired = false;
    try {
      if (!uploadId) await inspectCSVContent(csvFile);
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const signatureValues = [subject, body, isHtml, userEmail];
      if (savedCampaignId) signatureValues.push(savedCampaignId);
      // Keep existing send identities stable when no custom mapping is used.
      if (Object.keys(fieldMapping).length) signatureValues.push(fieldMapping);
      const signature = JSON.stringify(signatureValues);
      if (
        !batchRef.current ||
        batchRef.current.file !== csvFile ||
        batchRef.current.signature !== signature ||
        batchRef.current.uploadId !== uploadId
      ) {
        batchRef.current = {
          file: csvFile,
          uploadId,
          signature,
          ...(uploadId
            ? getUploadBatchIdentity(uploadId, signature)
            : await getBatchIdentity(csvFile, signature)),
        };
      }
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const data = { csvFile, uploadId, subject, body, isHtml, fieldMapping };
      const result = await sendEmails(data, {
        signal: controller.signal,
        batchId: batchRef.current.id,
        onCampaign: async (id) => {
          campaignRef.current = id;
          if (savedCampaignId && batchRef.current)
            rememberReusableSend(batchRef.current.fingerprint, id);
          if (cancelRequestedRef.current) await cancelCampaign(id);
        },
        onEvent: (event) => {
          if (event.type === 'auth_error') expired = true;
          appendLog(event.message);
        },
      });
      // A completed send from a saved campaign can intentionally be sent again.
      // Interrupted/paused attempts retain the key for safe retries.
      if (savedCampaignId && result?.state === 'complete' && batchRef.current) {
        forgetBatch(batchRef.current.fingerprint);
        batchRef.current = null;
      }
    } catch (error) {
      if (error.status === 401) expired = true;
      appendLog(
        error.name === 'AbortError'
          ? 'Stopped following progress. Any accepted send cannot be recalled.'
          : `Error: ${error.message}`
      );
    } finally {
      controllerRef.current = null;
      if (mountedRef.current) {
        setSending(false);
        if (expired) logout();
      }
    }
  };

  const cancel = async () => {
    cancelRequestedRef.current = true;
    try {
      if (campaignRef.current) await cancelCampaign(campaignRef.current);
      controllerRef.current?.abort();
      appendLog('Cancellation requested. Any in-flight message may finish.');
    } catch (error) {
      appendLog(`Cancellation failed: ${error.message}`);
    }
  };
  const downloadLogs = () =>
    campaignRef.current ? downloadCampaignLogs(campaignRef.current) : null;
  const reset = ({ forgetIdentity = true } = {}) => {
    if (controllerRef.current) return;
    if (batchRef.current && forgetIdentity) forgetBatch(batchRef.current.fingerprint);
    batchRef.current = null;
    campaignRef.current = null;
    setLogs([]);
  };
  return { logs, sending, send, cancel, reset, downloadLogs };
}
