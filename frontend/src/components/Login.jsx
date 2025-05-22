import React, { useEffect, useRef } from 'react';
import { jwtDecode } from 'jwt-decode';
import { useNavigate } from 'react-router-dom';

const emailFormEndPoint = process.env.REACT_APP_EMAILFORM_ENDPOINT;

const Login = ({ setUser }) => {
  const navigate = useNavigate();
  const didInit = useRef(false);
  const googleAuthClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    const handleCredentialResponse = (response) => {
      try {
        const userObject = jwtDecode(response.credential);
        localStorage.setItem('user', JSON.stringify(userObject));
        setUser(userObject);
        navigate(emailFormEndPoint);
      } catch (error) {
        console.error('Failed to decode token or set user', error);
      }
    };

    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.initialize({
        client_id: googleAuthClientId,
        callback: handleCredentialResponse,
      });

      window.google.accounts.id.renderButton(
        document.getElementById('google-signin-button'),
        { theme: 'outline', size: 'large' }
      );
    } else {
      console.warn('Google API not loaded yet.');
    }
  }, [setUser, navigate, googleAuthClientId]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 px-4">
      <header className="mb-12 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          <span className="text-blue-600 dark:text-blue-400">EmailBlast</span>
          <span className="ml-3 text-gray-600 dark:text-gray-400 text-xl font-light">Mass Mailer</span>
        </h1>
      </header>

      <main className="bg-white dark:bg-gray-800 p-10 rounded-lg shadow-lg w-full max-w-sm text-center">
        <h2 className="text-2xl font-semibold mb-6 text-gray-800 dark:text-gray-200">
          Sign in with Google
        </h2>
        <div id="google-signin-button" className="mx-auto"></div>
      </main>
    </div>
  );
};

export default Login;

