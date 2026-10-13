import { useEffect, useRef, useState } from 'react';
import {
  listSavedCampaigns,
  loadSavedCampaign,
  deleteSavedCampaign,
} from '../utils/campaignLibraryApi';

export default function useCampaignLibrary({
  selected,
  dirty,
  disabled,
  onBusy,
  onOpen,
  onSave,
  onNew,
  focusEditor,
  focusLibrary,
  confirm,
}) {
  const [campaigns, setCampaigns] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const locked = useRef(false);

  useEffect(() => {
    let active = true;
    listSavedCampaigns()
      .then((rows) => {
        if (active) setCampaigns(rows);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const act = async (operation) => {
    if (locked.current || disabled) return;
    locked.current = true;
    onBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (err) {
      setError(err.message);
    } finally {
      locked.current = false;
      onBusy(false);
    }
  };
  const canLeave = () => !dirty || confirm('Discard the unsaved changes in this editor?');
  const open = (id) =>
    act(async () => {
      if (!canLeave()) return;
      onOpen(await loadSavedCampaign(id));
      setNotice('Campaign opened. Its contact list is ready to reuse.');
      focusEditor();
    });
  const save = (copy) =>
    act(async () => {
      const saved = await onSave(copy);
      setCampaigns((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setSearch('');
      setNotice(copy ? 'New campaign copy saved.' : 'Campaign saved.');
    });
  const remove = (campaign, fromLibrary = false) =>
    act(async () => {
      if (!campaign) return;
      const isCurrent = selected?.id === campaign.id;
      const target = isCurrent ? selected : campaign;
      if (
        !confirm(
          `Delete saved campaign “${target.name}”?${isCurrent && dirty ? ' Unsaved edits will also be discarded.' : ''} Existing sends will be kept.`
        )
      )
        return;
      await deleteSavedCampaign(target.id, target.revision);
      setCampaigns((rows) => rows.filter((row) => row.id !== target.id));
      if (isCurrent) onNew();
      setNotice('Saved campaign deleted. Existing sends are unchanged.');
      if (fromLibrary) focusLibrary();
      else focusEditor();
    });
  const create = () => {
    if (locked.current || disabled || !canLeave()) return;
    onNew();
    setNotice('');
    setError('');
    focusEditor();
  };
  const visible = campaigns.filter((row) =>
    row.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return {
    campaigns,
    search,
    setSearch,
    visible,
    error,
    notice,
    loading,
    open,
    save,
    remove,
    create,
  };
}
