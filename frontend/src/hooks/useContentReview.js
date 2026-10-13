import { useEffect, useState } from 'react';
import { reviewSavedCampaign } from '../utils/aiApi';

// Kept separate from saving: failures and latency never block campaign persistence.
export default function useContentReview(saved, stale) {
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: 'idle' });

  useEffect(() => {
    if (!saved || !enabled || stale) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading', saved });
    reviewSavedCampaign(saved, controller.signal)
      .then((review) => {
        if (controller.signal.aborted) return;
        if (review.campaign_id !== saved.id || review.revision !== saved.revision)
          throw new Error('The reviewed version changed. Save again to refresh the review.');
        setState({ status: 'ready', saved, review });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ status: 'error', saved, error: error.message });
      });
    return () => controller.abort();
  }, [saved, enabled, stale, attempt]);

  // Reject a previous snapshot synchronously, before effect cleanup runs.
  const current = enabled && !stale && state.saved === saved ? state : { status: 'idle' };
  return { ...current, enabled, setEnabled, retry: () => setAttempt((value) => value + 1) };
}
