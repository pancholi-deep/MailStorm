import React, { useEffect, useRef, useState } from 'react';
import { useGoogleOAuth } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { createGoogleCodeClient } from '../utils/googleOAuth';
import { exchangeCodeForTokens } from '../utils/authApi';

import { emailFormPath } from '../utils/config';
import { saveSession } from '../utils/session';

const Login = ({ setUser, googleScriptError = false }) => {
  const navigate = useNavigate();
  const { clientId: googleAuthClientId, scriptLoadedSuccessfully } = useGoogleOAuth();
  const codeClientRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!googleAuthClientId || !scriptLoadedSuccessfully) return;
    let active = true;
    try {
      codeClientRef.current = createGoogleCodeClient(
        googleAuthClientId,
        async ({ code, error: oauthError }) => {
          if (!active) return;
          if (oauthError || !code) {
            setError('Google sign-in was not completed. Please try again.');
            setSigningIn(false);
            return;
          }
          try {
            const data = await exchangeCodeForTokens(code);
            if (!active) return;
            saveSession(data);
            setUser(data.user);
            navigate(emailFormPath);
          } catch (err) {
            if (active) setError('Unable to sign in. Please try again.');
          } finally {
            if (active) setSigningIn(false);
          }
        },
        () => {
          if (!active) return;
          setError('Google sign-in could not open or was closed. Please try again.');
          setSigningIn(false);
        }
      );
      setReady(true);
    } catch (err) {
      setError('Google sign-in is unavailable. Please reload and try again.');
    }

    return () => {
      active = false;
      codeClientRef.current = null;
      setReady(false);
    };
  }, [navigate, setUser, scriptLoadedSuccessfully, googleAuthClientId]);

  const handleLogin = () => {
    if (!ready || !codeClientRef.current || signingIn) return;
    setError('');
    setSigningIn(true);
    try {
      codeClientRef.current.requestCode();
    } catch (err) {
      setError('Google sign-in is unavailable. Please reload and try again.');
      setSigningIn(false);
    }
  };

  const loginError = !googleAuthClientId
    ? 'Google sign-in is not configured yet.'
    : googleScriptError
      ? 'Unable to load Google sign-in. Check your connection and reload.'
      : error;

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Left Panel */}
      <div className="w-1/2 flex flex-col justify-center items-start px-12 py-8 text-gray-800 dark:text-gray-200">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-5xl font-extrabold text-mailstormBlue">MailStorm</h1>
          <img
            src="/mailstorm.png" // update the path if needed
            alt="MailStorm Logo"
            className="h-15 w-16"
          />
        </div>
        <h2 className="text-2xl font-semibold mb-4">Mass Emailing Tool</h2>
        <p className="mb-3">
          MailStorm is a web-based tool designed to help users send personalized bulk emails using
          their Gmail accounts.
        </p>
        <p className="mb-3">
          You can upload a list of recipients and a message template, then easily send tailored
          emails to each person.
        </p>
        <p className="mb-3">
          Google Sign-In is used to securely send emails on your behalf through the Gmail API. Your
          data is not stored or accessed beyond sending emails.
        </p>
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 text-sm text-mailstormBlue hover:underline"
        >
          Privacy Policy
        </a>
      </div>

      {/* Right Panel */}
      <div className="w-1/2 flex flex-col justify-center items-center px-12 py-8 border-l border-gray-200 dark:border-gray-800">
        <h2 className="text-2xl font-semibold mb-6 text-gray-700 dark:text-gray-300">
          Sign in to Get Started
        </h2>
        <button
          id="google-login-btn"
          type="button"
          onClick={handleLogin}
          disabled={!ready || signingIn || googleScriptError}
          className="flex items-center gap-3 px-6 py-3 rounded-full bg-white border border-gray-300 shadow hover:shadow-md text-gray-700 text-sm font-medium"
        >
          <img
            src="https://developers.google.com/identity/images/g-logo.png"
            alt=""
            className="w-5 h-5"
          />
          {signingIn
            ? 'Signing in…'
            : !ready && !loginError
              ? 'Loading Google sign-in…'
              : 'Sign in with Google'}
        </button>
        {loginError && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {loginError}
          </p>
        )}
      </div>
    </div>
  );
};

export default Login;
