import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGoogleCodeClient } from '../utils/googleOAuth';
import { exchangeCodeForTokens } from '../utils/authApi';

const emailFormEndPoint = process.env.REACT_APP_EMAILFORM_ENDPOINT;
const googleAuthClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

const Login = ({ setUser }) => {
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const codeClient = createGoogleCodeClient(googleAuthClientId, async ({ code }) => {
        try {
          const data = await exchangeCodeForTokens(code);
          localStorage.setItem('user', JSON.stringify(data.user));
          localStorage.setItem('access_token', data.access_token);
          setUser(data.user);
          navigate(emailFormEndPoint);
        } catch (err) {
          console.error('Login failed', err);
        }
      });

      const loginBtn = document.getElementById('google-login-btn');
      if (loginBtn) {
        loginBtn.onclick = () => codeClient.requestCode();
      }
    } catch (err) {
      console.warn(err.message);
    }
  }, [navigate, setUser]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 px-4">
      <header className="mb-12 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          <span className="text-blue-600 dark:text-blue-400">EmailBlast</span>
          <span className="ml-3 text-gray-600 dark:text-gray-400 text-xl font-light">Mass Mailer</span>
        </h1>
      </header>
      <button
        id="google-login-btn"
        className="px-6 py-3 rounded-full bg-blue-600 text-white hover:bg-blue-700"
      >
        Login with Google
      </button>
    </div>
  );
};

export default Login;
