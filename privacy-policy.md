<!-- Generated from frontend/src/privacyPolicy.json. Run npm run sync:privacy in frontend. -->
# Privacy Policy

**Last updated: October 13, 2026**

MailStorm (referred to as “we”, “us”, or “our”) respects your privacy. This Privacy Policy describes how we collect, use, and protect your information when you use our application.

## Information We Collect

- **Google OAuth Information:** We receive your name, email address, and Google OAuth access and refresh tokens to send messages you request. Account profile information and Gmail credentials are encrypted and stored separately on the server. Your browser receives a separate application session token.
- **Uploaded Data:** Recipient data, message templates, and delivery records are stored to support background sending, progress recovery, and duplicate prevention. Database message data is encrypted. Production uploads are stored in private encrypted object storage; local development uses private files. Saved campaigns retain a reusable contact list, campaign name, filename, and email template. Names, filenames, and templates are encrypted in the database.

## How We Use Your Information

- To send bulk emails on your behalf using the Gmail API.
- To identify and authenticate you via Google Sign-In.

## Data Sharing and Disclosure

We do not sell or rent your personal information or Google account data. Recipient addresses and message content are sent to Google to deliver your emails.

## Data Retention and Deletion

Application sessions last up to seven days and are stored in browser sessionStorage. Sign out removes the browser session and requests server session revocation. Sending jobs continue when a tab closes; Cancel requests that remaining sends stop. Completed, cancelled, invalid, or paused sending jobs and their records are retained for 30 days after their last activity by default. Active sending jobs remain until they finish or are cancelled. Saved campaigns and their contact lists remain until you delete them; overwriting or deleting a saved campaign does not change existing sends or other saved copies. A running worker removes expired records and unreferenced uploads; unused uploads become eligible for deletion after one hour. Gmail credentials become eligible for removal after 30 days without sign-in or sending activity when no active sends need them, even if saved campaigns or application sessions remain. A running worker removes eligible credentials and requests revocation from Google. Disconnect Gmail immediately removes stored Gmail tokens, requests Google revocation, and cancels pending sends; a message already in progress may finish. Saved campaigns and your current application session remain. If Google revocation cannot be confirmed, remove MailStorm access in your Google account settings. Signing out alone does not disconnect Gmail. Deployment retention settings may vary; backups follow the hosting operator's retention policy. Downloaded logs remain wherever you save them.

## Data Security

OAuth client secrets and Google tokens remain on the backend. Application session tokens are accessible to scripts on the application origin; use HTTPS in production. Encryption keys and storage credentials must be protected by the hosting operator. Google authorization can be revoked from your Google account settings.

## Third-party Services

We use Google APIs to send emails. Your use of Google services is subject to [Google's Privacy Policy](https://policies.google.com/privacy).

## Your Consent

By using our app, you consent to this Privacy Policy.

## Contact

For privacy questions, contact [pancholi.deep11@gmail.com](mailto:pancholi.deep11@gmail.com).
