import React from 'react';

const PrivacyPolicy = () => {
  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: 'auto' }}>
      <h1>Privacy Policy</h1>
      <p>Last updated: May 31, 2025</p>

      <p>
        MailStorm (referred to as “we”, “us”, or “our”) respects your privacy. This Privacy Policy describes how we
        collect, use, and protect your information when you use our application. 
      </p>

      <br/>
      <h2>Information We Collect</h2>
      <ul>
        <li>
          <strong>Google OAuth Information:</strong> We collect your email address and access tokens through Google's
          secure OAuth 2.0 flow to send emails on your behalf.
        </li>
        <li>
          <strong>Uploaded Data:</strong> We process email addresses and content you upload only for sending emails as
          requested by you. This data is not stored on our servers.
        </li>
      </ul>

      <br/>
      <h2>How We Use Your Information</h2>
      <ul>
        <li>To send bulk emails on your behalf using the Gmail API.</li>
        <li>To identify and authenticate you via Google Sign-In.</li>
      </ul>

      <br/>
      <h2>Data Security</h2>
      <p>
        We use industry-standard security practices. Access tokens are stored temporarily in memory during active
        sessions and are never stored persistently.
      </p>

      <br/>
      <h2>Third-party Services</h2>
      <p>
        We use Google APIs to send emails. Your use of Google services is subject to{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
          Google’s Privacy Policy
        </a>
        .
      </p>

      <br/>
      <h2>Your Consent</h2>
      <p>By using our app, you consent to our privacy policy.</p>

      <br/>
      <h2>Contact</h2>
      <p>If you have any questions, contact us at pancholi.deep11@gmail.com</p>
    </div>
  );
};

export default PrivacyPolicy;
