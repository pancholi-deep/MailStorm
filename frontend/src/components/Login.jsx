import React, { useEffect, useRef, useState } from 'react';
import { useGoogleOAuth } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { createGoogleCodeClient } from '../utils/googleOAuth';
import { exchangeCodeForTokens } from '../utils/authApi';

import { emailFormPath } from '../utils/config';
import { saveSession } from '../utils/session';
import useThemeMode from '../hooks/useThemeMode';
import ThemeToggle from './ThemeToggle';
import './AppTheme.css';
import './Login.css';

const Login = ({ setUser, googleScriptError = false }) => {
  const navigate = useNavigate();
  const { clientId: googleAuthClientId, scriptLoadedSuccessfully } = useGoogleOAuth();
  const codeClientRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [darkMode, setDarkMode] = useThemeMode();

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
    <div className={`mailstorm-theme login-page ${darkMode ? 'workspace-dark' : ''}`}>
      <header className="login-topbar">
        <div className="login-brand">
          <img src="/mailstorm.png" alt="" width="38" height="38" />
          <span>MailStorm</span>
          <span className="login-brand-caption">Mass Mailer</span>
        </div>
        <div className="login-header-actions">
          <a
            className="login-privacy-link"
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy Policy <span aria-hidden="true">↗</span>
          </a>
          <ThemeToggle darkMode={darkMode} setDarkMode={setDarkMode} />
        </div>
      </header>
      <main className="login-layout">
        <section className="login-intro" aria-labelledby="welcome-heading">
          <p className="login-eyebrow">A little more personal. A lot less repetitive.</p>
          <h1 id="welcome-heading">
            Make every message <span>feel personal.</span>
          </h1>
          <p className="login-lead">
            Your contacts, content, and campaigns in one place. Send personalized emails from your
            Gmail account and keep your next follow-up ready to go.
          </p>
          <ol className="login-features">
            <li>
              <span className="login-step" aria-hidden="true">
                01
              </span>
              <div>
                <h2>Bring your contacts</h2>
                <p>Upload a CSV once and reuse it in saved campaigns.</p>
              </div>
            </li>
            <li>
              <span className="login-step" aria-hidden="true">
                02
              </span>
              <div>
                <h2>Make it your message</h2>
                <p>
                  Write or import a template, map your fields, and preview the personal touches.
                </p>
              </div>
            </li>
            <li>
              <span className="login-step" aria-hidden="true">
                03
              </span>
              <div>
                <h2>Send and stay in the loop</h2>
                <p>Follow sending progress and pick up your next campaign where you left off.</p>
              </div>
            </li>
          </ol>
        </section>
        <section className="login-card" aria-labelledby="sign-in-heading">
          <div className="login-card-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <rect
                x="3"
                y="5"
                width="18"
                height="14"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="m4 7 8 6 8-6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="login-eyebrow">Your workspace awaits</p>
          <h2 id="sign-in-heading">Let’s get started.</h2>
          <p className="login-card-description">
            Sign in to open your saved campaigns or create something new.
          </p>
          <button
            id="google-login-btn"
            type="button"
            onClick={handleLogin}
            disabled={!ready || signingIn || googleScriptError}
            className="google-login-button"
            aria-busy={signingIn}
          >
            <img src="/google-logo.png" alt="" width="20" height="20" />
            {signingIn
              ? 'Signing in…'
              : !ready && !loginError
                ? 'Loading Google sign-in…'
                : 'Sign in with Google'}
          </button>
          {loginError && (
            <p role="alert" className="login-error">
              {loginError}
            </p>
          )}
          <div className="login-connection-note">
            <strong>Connected through Google</strong>
            <p>
              Google sign-in lets MailStorm send emails on your behalf through Gmail. Your saved
              campaigns and delivery records stay available for reuse and tracking.
            </p>
            <p>You can disconnect Gmail from your workspace at any time.</p>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Login;
