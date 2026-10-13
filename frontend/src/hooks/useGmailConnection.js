import { useCallback, useEffect, useRef, useState } from 'react';
import { disconnectGmail, getGmailStatus } from '../utils/gmailApi';

export default function useGmailConnection() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const active = useRef(true);
  const disconnecting = useRef(false);

  const refresh = useCallback(async () => {
    if (disconnecting.current) return;
    const current = ++sequence.current;
    try {
      const result = await getGmailStatus();
      if (active.current && current === sequence.current) {
        setStatus(result);
        setError('');
      }
    } catch (err) {
      if (active.current && current === sequence.current) {
        setStatus(null);
        setError(err.message);
      }
    }
  }, []);

  useEffect(() => {
    active.current = true;
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active.current = false;
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const disconnect = async () => {
    if (disconnecting.current) return false;
    disconnecting.current = true;
    ++sequence.current;
    setBusy(true);
    setError('');
    try {
      const result = await disconnectGmail();
      if (active.current) setStatus(result);
      return true;
    } catch (err) {
      // A lost response may follow a successful detach; recheck server state.
      disconnecting.current = false;
      await refresh();
      if (active.current) setError(err.message);
      return false;
    } finally {
      disconnecting.current = false;
      if (active.current) setBusy(false);
    }
  };

  return { status, busy, error, refresh, disconnect };
}
