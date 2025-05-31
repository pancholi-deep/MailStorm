import React, { useEffect, useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import EmailForm from './components/EmailForm';
import OAuthCallback from './components/OAuthCallback';
import PrivacyPolicy from './components/PrivacyPolicy';
import { AuthContext } from './context/authContext';

const loginEndPoint = process.env.REACT_APP_LOGIN_ENDPOINT;
const sendEmailsEndPoint = process.env.REACT_APP_SENDEMAIL_ENDPOINT;
const oAuthEndPoint = process.env.REACT_APP_OAUTH_ENDPOINT;

const App = () => {
  const { user, setUser } = useContext(AuthContext);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser && !user) {
      setUser(JSON.parse(storedUser));
    }
  }, [user, setUser]);

  return (
    <Routes>
      <Route 
        path={oAuthEndPoint} 
        element={<OAuthCallback setUser={setUser} />} />
      <Route 
        path="/" 
        element={<Navigate to={loginEndPoint} />} 
      />
      <Route
        path={loginEndPoint}
        element={!user ? <Login setUser={setUser} /> : <Navigate to={sendEmailsEndPoint} />}
      />
      <Route
        path={sendEmailsEndPoint}
        element={user ? <EmailForm user={user} setUser={setUser} /> : <Navigate to="/" />}
      />
      <Route 
        path="/privacy" 
        element={<PrivacyPolicy />} 
      />
    </Routes>
  );
};

export default App;

