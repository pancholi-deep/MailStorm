// utils/googleOAuth.js
export function createGoogleCodeClient(clientId, callback) {
    if (!window.google || !window.google.accounts?.oauth2) {
      throw new Error('Google API not loaded');
    }
    return window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'openid',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ].join(' '),
      ux_mode: 'popup',
      callback,
    });
  }
  