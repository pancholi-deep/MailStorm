import { jsonRequest } from './httpClient';

export const getGmailStatus = () => jsonRequest('/v1/gmail');
export const disconnectGmail = () => jsonRequest('/v1/gmail/disconnect', { method: 'POST' });
