import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const emailFormEndPoint = process.env.REACT_APP_EMAILFORM_ENDPOINT;
const googleAuthClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

const Login = ({ setUser }) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!window.google) {
      console.warn('Google API not loaded');
      return;
    }

    const codeClient = window.google.accounts.oauth2.initCodeClient({
      client_id: googleAuthClientId,
      scope: 'https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      ux_mode: 'popup',
      callback: async (response) => {
        try {
          const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: response.code }),
            credentials: 'include',
          });

          if (!res.ok) throw new Error('Backend auth failed');

          const data = await res.json();
          localStorage.setItem('user', JSON.stringify(data.user));
          setUser(data.user);
          navigate(emailFormEndPoint);
        } catch (err) {
          console.error('Login failed', err);
        }
      },
    });

    const loginBtn = document.getElementById('google-login-btn');
    if (loginBtn) {
      loginBtn.onclick = () => codeClient.requestCode();
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
      <button id="google-login-btn" className="px-6 py-3 rounded-full bg-blue-600 text-white hover:bg-blue-700">
        Login with Google
      </button>
    </div>
  );
};

export default Login;
