// The application uses popup OAuth. Keep legacy callback URLs as safe redirects.
import React from 'react';
import { Navigate } from 'react-router-dom';
import { loginPath } from '../utils/config';

export default function OAuthCallback() {
  return <Navigate to={loginPath} replace />;
}
