import { request } from './emailApi';
const base = '/v1/saved-campaigns';
const json = async (path, options) => (await request(path, options)).json();
const body = (data, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
export const listSavedCampaigns = () => json(base);
export const loadSavedCampaign = id => json(`${base}/${id}`);
export const createSavedCampaign = data => json(base, body(data));
export const overwriteSavedCampaign = (id, data) => json(`${base}/${id}`, body(data, 'PUT'));
export const deleteSavedCampaign = (id, revision) => json(`${base}/${id}/delete`, body({ revision }));
