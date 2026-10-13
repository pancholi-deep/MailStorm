import sha256 from 'node-forge/lib/sha256';
import { hashFile } from './emailApi';
const STORAGE_KEY = 'mailstorm_batches';
const RETENTION_MS = 86400000;

export async function getBatchIdentity(file, signature) {
  const contentHash = await hashFile(file);
  const fingerprint = sha256.create().update(JSON.stringify([signature, contentHash]), 'utf8').digest().toHex();
  let batches = [];
  try { batches = JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || []; } catch { /* Start with an empty index. */ }
  if (!Array.isArray(batches)) batches = [];
  batches = batches.filter(batch => batch.created > Date.now() - RETENTION_MS);
  let batch = batches.find(candidate => candidate.fingerprint === fingerprint);
  if (!batch) {
    batch = { fingerprint, id: crypto.randomUUID(), created: Date.now() };
    batches.push(batch);
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
  return batch;
}

export function forgetBatch(fingerprint) {
  try {
    const batches = JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || [];
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(batches.filter(batch => batch.fingerprint !== fingerprint)));
  } catch { /* A reset should still work if storage was cleared. */ }
}
