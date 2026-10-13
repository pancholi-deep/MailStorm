import React from 'react';
import policy from '../privacyPolicy.json';

const PrivacyPolicy = () => {
  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: 'auto' }}>
      <h1>Privacy Policy</h1>
      <p>Last updated: {policy.updated}</p>

      <p>
        {policy.intro}
      </p>

      <br />
      <h2>Information We Collect</h2>
      <ul>
        <li>
          <strong>Google OAuth Information:</strong> {policy.oauth}
        </li>
        <li>
          <strong>Uploaded Data:</strong> {policy.uploads}
        </li>
      </ul>

      <br />
      <h2>How We Use Your Information</h2>
      <ul>
        <li>To send bulk emails on your behalf using the Gmail API.</li>
        <li>To identify and authenticate you via Google Sign-In.</li>
      </ul>

      <br />
      <h2>Data Sharing and Disclosure</h2>
      <p>
        {policy.sharing}
      </p>

      <br />
      <h2>Data Retention and Deletion</h2>
      <p>
        {policy.retention} For privacy questions, please contact us at
        <a href={`mailto:${policy.contact}`}> {policy.contact}</a>.
      </p>

      <br />
      <h2>Data Security</h2>
      <p>
        {policy.security}
      </p>

      <br />
      <h2>Third-party Services</h2>
      <p>
        We use Google APIs to send emails. Your use of Google services is subject to{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
          Google’s Privacy Policy
        </a>
        .
      </p>

      <br />
      <h2>Your Consent</h2>
      <p>By using our app, you consent to this Privacy Policy.</p>

      <br />
      <h2>Contact</h2>
      <p>If you have any questions, contact us at <a href={`mailto:${policy.contact}`}>{policy.contact}</a></p>
    </div>
  );
};

export default PrivacyPolicy;
