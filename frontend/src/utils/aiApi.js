import { jsonBody, jsonRequest } from './httpClient';

export const getAiStatus = (signal) => jsonRequest('/v1/ai/status', { signal });
export const reviewSavedCampaign = (campaign, signal) =>
  jsonRequest('/v1/ai/review', {
    ...jsonBody({ campaign_id: campaign.id, revision: campaign.revision, consent: true }),
    signal,
    timeoutMs: 40000,
  });
export async function generateEmailSuggestion(value, signal) {
  try {
    return await jsonRequest('/v1/ai/assist', { ...jsonBody(value), signal, timeoutMs: 75000 });
  } catch (error) {
    if (error.message.startsWith('Request timed out.'))
      throw new Error('AI took too long to respond. Your draft is unchanged. Try again later.');
    throw error;
  }
}
