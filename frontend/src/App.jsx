import React, { useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import EmailForm from './components/EmailForm';
import OAuthCallback from './components/OAuthCallback';
import PrivacyPolicy from './components/PrivacyPolicy';
import { AuthContext } from './context/authContext';

import {
  loginPath as loginEndPoint,
  emailFormPath as sendEmailsEndPoint,
  oauthPath as oAuthEndPoint,
} from './utils/config';

const App = ({ googleScriptError = false }) => {
  const { user, setUser } = useContext(AuthContext);

  return (
    <Routes>
      <Route path={oAuthEndPoint} element={<OAuthCallback />} />
      <Route path="/" element={<Navigate to={loginEndPoint} />} />
      <Route
        path={loginEndPoint}
        element={
          !user ? (
            <Login setUser={setUser} googleScriptError={googleScriptError} />
          ) : (
            <Navigate to={sendEmailsEndPoint} />
          )
        }
      />
      <Route path={sendEmailsEndPoint} element={user ? <EmailForm /> : <Navigate to="/" />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
