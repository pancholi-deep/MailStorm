import { useEffect, useRef, useState } from 'react';
import { sendEmails, cancelCampaign, listCampaigns, observeCampaign, downloadCampaignLogs } from '../utils/emailApi';
import { validateCSVContent } from '../utils/validationUtils';
import { forgetBatch, getBatchIdentity } from '../utils/batchUtils';

export default function useEmailSending(logout) {
  const [logs, setLogs] = useState([]);
  const [sending, setSending] = useState(false);
  const controllerRef = useRef(null);
  const batchRef = useRef(null);
  const campaignRef = useRef(null);
  const cancelRequestedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    listCampaigns().then(jobs => {
      if (!mountedRef.current || controllerRef.current) return;
      const job = jobs.find(item => ['importing', 'queued', 'running', 'retry_wait'].includes(item.state));
      if (!job) return;
      campaignRef.current = job.id;
      const controller = new AbortController();
      controllerRef.current = controller;
      setSending(true);
      setLogs(['Reconnected to your running campaign.']);
      observeCampaign(job.id, { signal: controller.signal, onEvent: event => {
        if (mountedRef.current) setLogs(previous => [...previous, event.message].slice(-500));
      }}).catch(error => {
        if (mountedRef.current && error.name !== 'AbortError') setLogs(previous => [...previous, error.message].slice(-500));
      }).finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
        if (mountedRef.current) setSending(false);
      });
    }).catch(() => { /* Sign-in and explicit sends report session failures. */ });
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const send = async ({ csvFile, subject, body, isHtml, userEmail }) => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    campaignRef.current = null;
    cancelRequestedRef.current = false;
    setSending(true);
    setLogs([]);
    let expired = false;
    try {
      await validateCSVContent(csvFile);
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const signature = JSON.stringify([subject, body, isHtml, userEmail]);
      if (!batchRef.current || batchRef.current.file !== csvFile || batchRef.current.signature !== signature) {
        batchRef.current = { file: csvFile, signature, ...await getBatchIdentity(csvFile, signature) };
      }
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const data = new FormData();
      data.append('csv_file', csvFile);
      data.append('email_subject', subject);
      data.append('email_body', body);
      data.append('isHtml', String(isHtml));
      await sendEmails(data, {
        signal: controller.signal,
        batchId: batchRef.current.id,
        onCampaign: async id => {
          campaignRef.current = id;
          if (cancelRequestedRef.current) await cancelCampaign(id);
        },
        onEvent: event => {
          if (event.type === 'auth_error') expired = true;
          if (mountedRef.current) setLogs(previous => [...previous, event.message].slice(-500));
        },
      });
    } catch (error) {
      if (error.status === 401) expired = true;
      if (mountedRef.current) setLogs(previous => [...previous,
        error.name === 'AbortError' ? 'Stopped following progress. Any accepted send cannot be recalled.' : `Error: ${error.message}`,
      ].slice(-500));
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
      if (mountedRef.current) setLogs(previous => [...previous, 'Cancellation requested. Any in-flight message may finish.'].slice(-500));
    } catch (error) {
      if (mountedRef.current) setLogs(previous => [...previous, `Cancellation failed: ${error.message}`].slice(-500));
    }
  };
  const downloadLogs = () => campaignRef.current ? downloadCampaignLogs(campaignRef.current) : null;
  const reset = () => {
    if (controllerRef.current) return;
    if (batchRef.current) forgetBatch(batchRef.current.fingerprint);
    batchRef.current = null;
    campaignRef.current = null;
    setLogs([]);
  };
  return { logs, sending, send, cancel, reset, downloadLogs };
}
