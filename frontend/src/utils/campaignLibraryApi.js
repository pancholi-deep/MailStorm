import { jsonRequest as json, jsonBody as body } from './httpClient';
const base = '/v1/saved-campaigns';
export const listSavedCampaigns = () => json(base);
export const loadSavedCampaign = (id) => json(`${base}/${id}`);
export const createSavedCampaign = (data) => json(base, body(data));
export const overwriteSavedCampaign = (id, data) => json(`${base}/${id}`, body(data, 'PUT'));
export const deleteSavedCampaign = (id, revision) =>
  json(`${base}/${id}/delete`, body({ revision }));
