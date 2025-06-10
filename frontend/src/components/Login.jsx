import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGoogleCodeClient } from '../utils/googleOAuth';
import { exchangeCodeForTokens } from '../utils/authApi';

const emailFormEndPoint = process.env.REACT_APP_EMAILFORM_ENDPOINT;
const googleAuthClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

const Login = ({ setUser }) => {
  const navigate = useNavigate();

  useEffect(() => {
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
  }, [navigate, setUser]);

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Left Panel */}
      <div className="w-1/2 flex flex-col justify-center items-start px-12 py-8 text-gray-800 dark:text-gray-200">
        <h1 className="text-5xl font-extrabold mb-6 text-blue-600 dark:text-blue-400">MailStorm</h1>
        <h2 className="text-2xl font-semibold mb-4">Mass Emailing Tool</h2>
        <p className="mb-3">
          MailStorm is a web-based tool designed to help users send personalized bulk emails using their Gmail accounts.
        </p>
        <p className="mb-3">
          You can upload a list of recipients and a message template, then easily send tailored emails to each person.
        </p>
        <p className="mb-3">
          Google Sign-In is used to securely send emails on your behalf through the Gmail API. Your data is not stored or accessed beyond sending emails.
        </p>
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 text-sm text-blue-500 hover:underline"
        >
          Privacy Policy
        </a>
      </div>

      {/* Right Panel */}
      <div className="w-1/2 flex flex-col justify-center items-center px-12 py-8 border-l border-gray-200 dark:border-gray-800">
        <h2 className="text-2xl font-semibold mb-6 text-gray-700 dark:text-gray-300">Sign in to Get Started</h2>
        <button
          id="google-login-btn"
          className="flex items-center gap-3 px-6 py-3 rounded-full bg-white border border-gray-300 shadow hover:shadow-md text-gray-700 text-sm font-medium"
        >
          <img
            src="https://developers.google.com/identity/images/g-logo.png"
            alt="Google"
            className="w-5 h-5"
          />
          Sign in with Google
        </button>
      </div>
    </div>
  );
};

export default Login;
