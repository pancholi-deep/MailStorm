import { request, jsonRequest, jsonBody } from './httpClient';
import { hashFile } from './fileHash';

export async function uploadContacts(file, signal) {
  const reservation = await jsonRequest('/v1/uploads', {
    ...jsonBody({ size: file.size, sha256: await hashFile(file) }),
    signal,
  });
  if (reservation.method === 'PUT') {
    await request(reservation.url, { method: 'PUT', body: file, signal });
  } else {
    const body = new FormData();
    Object.entries(reservation.fields).forEach(([key, value]) => body.append(key, value));
    body.append('file', file);
    const response = await fetch(reservation.url, { method: 'POST', body, signal });
    if (!response.ok) throw new Error('Object upload failed. Please try again.');
  }
  await jsonRequest(`/v1/uploads/${reservation.id}/complete`, { method: 'POST', signal });
  return reservation.id;
}
