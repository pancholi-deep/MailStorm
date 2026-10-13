// The page and generated Markdown policy share the same JSON content source.
const fs = require('fs');
const path = require('path');
const policy = require('../src/privacyPolicy.json');
const target = path.resolve(__dirname, '../../privacy-policy.md');
const output = `<!-- Generated from frontend/src/privacyPolicy.json. Run npm run sync:privacy in frontend. -->
# Privacy Policy

**Last updated: ${policy.updated}**

${policy.intro}

## Information We Collect

- **Google OAuth Information:** ${policy.oauth}
- **Uploaded Data:** ${policy.uploads}

## How We Use Your Information

- To send bulk emails on your behalf using the Gmail API.
- To identify and authenticate you via Google Sign-In.

## Data Sharing and Disclosure

${policy.sharing}

## Data Retention and Deletion

${policy.retention}

## Data Security

${policy.security}

## Third-party Services

We use Google APIs to send emails. Your use of Google services is subject to [Google's Privacy Policy](https://policies.google.com/privacy).

## Your Consent

By using our app, you consent to this Privacy Policy.

## Contact

For privacy questions, contact [${policy.contact}](mailto:${policy.contact}).
`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output) {
    console.error('Privacy policy is out of date. Run npm run sync:privacy.');
    process.exit(1);
  }
} else {
  fs.writeFileSync(target, output);
}
