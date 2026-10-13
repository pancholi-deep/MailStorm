import sha256 from 'node-forge/lib/sha256';
import { hashFile } from './fileHash';
const STORAGE_KEY = 'mailstorm_batches';
const RETENTION_MS = 86400000;
const readBatches = () => JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || [];
const writeBatches = (batches) => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(batches));

export async function getBatchIdentity(file, signature) {
  const contentHash = await hashFile(file);
  const fingerprint = sha256
    .create()
    .update(JSON.stringify([signature, contentHash]), 'utf8')
    .digest()
    .toHex();
  return storedIdentity(fingerprint);
}

export function getUploadBatchIdentity(uploadId, signature) {
  const fingerprint = sha256
    .create()
    .update(JSON.stringify(['stored-upload', uploadId, signature]), 'utf8')
    .digest()
    .toHex();
  return storedIdentity(fingerprint);
}

function storedIdentity(fingerprint) {
  let batches = [];
  try {
    batches = readBatches();
  } catch {
    /* Start with an empty index. */
  }
  if (!Array.isArray(batches)) batches = [];
  batches = batches.filter((batch) => batch.created > Date.now() - RETENTION_MS);
  let batch = batches.find((candidate) => candidate.fingerprint === fingerprint);
  if (!batch) {
    batch = { fingerprint, id: crypto.randomUUID(), created: Date.now() };
    batches.push(batch);
  }
  writeBatches(batches);
  return batch;
}

function updateBatches(transform) {
  try {
    writeBatches(transform(readBatches()));
  } catch {
    /* Clearing unavailable or corrupt storage must not block the editor. */
  }
}

export function forgetBatch(fingerprint) {
  updateBatches((batches) => batches.filter((batch) => batch.fingerprint !== fingerprint));
}

export function rememberReusableSend(fingerprint, jobId) {
  updateBatches((batches) =>
    batches.map((batch) => (batch.fingerprint === fingerprint ? { ...batch, jobId } : batch))
  );
}

export function finishReusableSend(jobId) {
  updateBatches((batches) => batches.filter((batch) => batch.jobId !== jobId));
}
