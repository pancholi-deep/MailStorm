// OAuthCallback.jsx
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const OAuthCallback = ({ setUser }) => {
  const navigate = useNavigate();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (!code) {
      console.error('Authorization code not found');
      return;
    }

    const exchangeCodeForToken = async () => {
      try {
        const response = await fetch('http://localhost:8000/auth/google/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) {
          throw new Error('Token exchange failed');
        }

        const data = await response.json();

        // Save user and token
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('user', JSON.stringify(data.user));

        setUser(data.user);
        navigate('/emailform');
      } catch (error) {
        console.error('OAuth flow failed', error);
      }
    };

    exchangeCodeForToken();
  }, [navigate, setUser]);

  return <div className="text-center mt-10 text-gray-700">Logging you in…</div>;
};

export default OAuthCallback;