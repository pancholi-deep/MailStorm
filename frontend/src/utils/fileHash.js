import sha256 from 'node-forge/lib/sha256';

export async function hashFile(file) {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += 262144) {
    const bytes = new Uint8Array(await file.slice(offset, offset + 262144).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    hash.update(binary);
  }
  return hash.digest().toHex();
}
