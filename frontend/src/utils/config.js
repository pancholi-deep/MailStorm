// Browser routes and API paths are separate, with legacy environment fallbacks.
export const backendURL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000').replace(
  /\/$/,
  ''
);
export const loginPath = process.env.REACT_APP_LOGIN_ENDPOINT || '/login';
export const emailFormPath =
  process.env.REACT_APP_EMAILFORM_ENDPOINT ||
  process.env.REACT_APP_SENDEMAIL_ENDPOINT ||
  '/emailform';
export const oauthPath = process.env.REACT_APP_OAUTH_ENDPOINT || '/oauth/callback';
export const googleAuthPath = process.env.REACT_APP_GOOGLE_AUTH_ENDPOINT || '/auth/google';
