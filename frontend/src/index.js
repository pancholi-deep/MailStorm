import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthProvider } from './context/authContext';
import { BrowserRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';

const root = ReactDOM.createRoot(document.getElementById('root'));
const googleAuthClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

function Root() {
  const [googleScriptError, setGoogleScriptError] = useState(false);
  return (
    <GoogleOAuthProvider
      clientId={googleAuthClientId}
      onScriptLoadSuccess={() => setGoogleScriptError(false)}
      onScriptLoadError={() => setGoogleScriptError(true)}
    >
      <BrowserRouter>
        <AuthProvider>
          <App googleScriptError={googleScriptError} />
        </AuthProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
