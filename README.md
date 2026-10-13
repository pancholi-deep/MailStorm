# MailStorm

MailStorm helps you send personalized emails from your Google account and save reusable campaigns with a contact list and email content.

## Send your first email

1. Open MailStorm and **Sign in with Google**.
2. Under **Recipients**, choose or drop a CSV containing your contacts. The selected filename appears in the upload area.
3. Enter an **Email Subject** and **Email Body**, or choose **Import template**, select a TXT or HTML file, and click **Use template**.
4. Click a CSV field to insert it into your message. Use **Fields & preview** to map fields and check a first-contact preview. If you write HTML, enable **Email body contains HTML**.
5. Click **Send Emails** and follow the progress in **Send activity**. Use **Download Logs** to export the results.

Saving a campaign is optional. You can send directly from the editor.

## Prepare your contact list

Use a UTF-8 CSV with `name` and `email` columns:

```csv
name,email
Alice Smith,alice@example.org
Bob Jones,bob@example.org
```

Column names are case insensitive. Blank rows are skipped. Put values containing commas inside double quotes. Every contact must have a name and a valid email address; an invalid list is rejected before any messages are sent. Recipients can use any email provider.

The usual limits are **500 recipients** and **2 MiB per CSV**. Your installation may use different limits.

## Write or import a message

You can type directly into the subject and body fields or import a template. After importing, you can edit both fields before saving or sending.

- `{name}` inserts the first word of the contact's name: `Alice Smith` becomes `Alice`.
- `{email}` inserts the contact's email address.
- Other CSV columns work too: a `company` column can be used as `{company}` in the subject or body.

Click a field chip to insert it at the cursor in the subject or body. Open the collapsible **Fields & preview** sidebar on the right of the workspace (above the editor on smaller screens) for instructions, mapping controls, and a first-contact preview. HTML previews show personalized source.

Column headers are trimmed and lowercased. Placeholder names are case sensitive and use letters, numbers, and underscores, starting with a letter or underscore. For a column with spaces, or a template that uses different names, type a placeholder such as `{company}` and select its CSV column, such as `company name`, under **Map placeholders**. Every placeholder must match or map to an existing column. `{name}` and `{email}` remain fixed; map `{full_name}` to `name` if you want the complete name.

Missing fields block saving and sending until you choose a valid column or remove the placeholder. Replacing a CSV checks the mappings again. Blank custom cells insert empty text, so review your contact list as well as the first-contact preview. Values inserted into HTML are escaped as text.

For a plain-text template, save a `.txt` file with this structure:

```text
Subject: Hello {name}
Body: Thanks for your interest!
We're following up at {email}.
```

For an HTML template, save a `.html` file:

```html
<!-- Subject: Hello {name} -->
<p>Hi {name},</p>
<p>Thanks for your interest! We're following up at {email}.</p>
```

The HTML subject comment is optional; enter a subject in the editor if the template does not provide one. Contact values inserted into HTML are treated as text. The usual message limits are 998 subject characters and 1,000,000 body characters.

## Write with AI Assist

When AI is enabled for your app, open **AI Assist** in the Message section. Choose **Draft from a brief**, **Shorten**, **Proofread**, or **Change tone**. Drafting starts from your brief; the other actions work on the current subject and body. You can choose a professional, friendly, or formal tone for drafting and tone changes.

Review the sharing notice, confirm that your input contains no personal or confidential information, and click **Generate suggestion**. Drafting shares your brief and available placeholder names with Google Gemini; rewriting shares your subject and email text. CSV rows and account credentials are not included automatically. Google’s free AI service may use inputs and outputs for model improvement and human review; see [Google’s AI terms](https://ai.google.dev/gemini-api/terms).

Review the suggested subject and body, then choose **Apply to draft** or **Discard suggestion**. Applying replaces the current subject and body without saving or sending. Save the campaign, save a copy, or continue editing as usual. Editing or switching campaigns discards suggestions so they cannot overwrite newer work.

New drafts are formatted HTML emails with a heading, spaced paragraphs, and optional bullet points. Include an HTTP(S) URL in your brief if you want a call-to-action button; otherwise the draft can invite a reply. Review the rendered preview or expand **View HTML source**, then choose **Apply to draft** to use it. Preview links and external images are disabled; email apps may render styling differently.

Rewrites preserve placeholders. HTML rewrites keep existing tags, links, and styles and update their text. AI accepts briefs up to 2,000 characters and rewrites of bodies up to 20,000 characters; complex HTML may exceed its text-section limit. Check generated facts and wording before sending. If AI is unavailable or reaches its allowance, manual editing, saving, and sending remain available.

## Review content before sending

Click **Save campaign**, **Save changes**, or **Save as new copy** to see a **Content spam-risk** percentage and suggestions for reducing content warnings. Saved campaigns also show a fresh check when reopened. Editing the subject, body, or format marks the check as outdated; save again to refresh it. Saving still saves your campaign even when the score is high.

The initial score uses local checks, **not the probability that Gmail will mark an email as spam**. MailStorm adds fixed warning points for patterns such as misleading links, hidden content, repeated punctuation, or high-pressure wording. Below 25 is low, 25–49 is moderate, and 50–100 is high. These local checks do not use AI quota.

For a contextual assessment, enable **Use Gemini to review this saved draft and future saves** in the review panel. Read the sharing notice first and confirm the email contains no personal or confidential information. This sends the subject, email text, and link information to Gemini, without attaching CSV rows or account credentials. Opening another campaign or starting a new one resets this choice.

Saving completes immediately; Gemini reviews in the background. Its assessment includes excerpts and specific suggestions. Technical checks for unsafe links, scripts, hidden content, misleading links, and oversized HTML remain included: the displayed score is the higher of the AI assessment and the technical warning total, rather than their sum. The result is an uncalibrated content assessment, not a delivery prediction, and AI can make mistakes.

Unchanged-content results may be reused for up to 15 minutes. Reviews share your AI Assist allowance and support up to 20,000 characters of text and link information. If AI times out, reaches its allowance, or cannot review the content, your campaign stays saved and local checks remain visible. **Retry AI review** lets you try again. There is no automatic paid fallback.

A low score does not guarantee inbox delivery. The check uses the template before CSV personalization and cannot assess sender authentication, reputation, recipient consent, or complaints. Follow the [Gmail sender guidelines](https://support.google.com/mail/answer/81126?hl=en), use accurate sender details, and provide a working unsubscribe option for marketing or subscription emails.

## Save and reuse campaigns

A campaign combines a name, contact list, subject, message body, field mappings, and plain-text or HTML choice. For example, save a **Sales pitch** campaign once, then adjust its message for each follow-up without uploading the same contacts again. Mappings are restored when you reopen a campaign and retained when you save changes or create a copy.

| Action | How it works |
| --- | --- |
| Save a campaign | Enter a **Campaign name**, choose contacts, write your message, and click **Save campaign**. Saving does not send emails. |
| Open a campaign | Select it from the campaign library. Its contacts and message are restored. Use search to find it by name. On mobile, open **Browse campaigns** first. |
| Update a campaign | Edit the name, message, or contact list, then click **Save changes** to overwrite the selected campaign. |
| Make a copy | Click **Save as new copy** to keep the original and create a separate campaign. Copies default to a “(copy)” name. |
| Send a variation | Edit the message and click **Send Emails**. Sending uses your current edits without automatically saving them to the campaign. |
| Delete a campaign | Click the small delete button beside it in the library, or **Delete campaign** in the editor, then confirm. Other copies and existing sends are retained. |
| Start fresh | Use **New campaign** or **Reset** to clear the editor. This does not delete a saved campaign. |

Saved campaigns remain available between sessions when you sign in with the same Google account. They stay until you delete them, including their contact lists. You can save up to **100 campaigns** per account. Unsaved editor changes are not a saved campaign.

If a campaign was changed in another tab, reopen its latest version before overwriting or deleting it. To keep your current edits separately, save a new copy.

## Manage Gmail access

**Sign Out** ends your MailStorm session. **Disconnect Gmail** also removes stored Gmail tokens, asks Google to revoke access, and stops pending sends. A message already in progress may finish. Your saved campaigns and current draft stay available, and you can continue editing and saving while disconnected.

Choose **Reconnect Gmail** to sign in again before sending. Save any draft first; reconnecting returns you to sign-in. If Google revocation cannot be confirmed, MailStorm shows a link to remove its access in your Google account settings.

Gmail access is also removed after 30 days without sign-in or sending activity, once no active sends need it. Saved campaigns remain available. Signing in again reconnects Gmail; explicitly cancelled sends do not restart automatically.

## Follow a send

Sending continues if you close or reload the browser. When you return while still signed in, MailStorm reconnects to a running send. **Cancel Sending** stops further sending, although a message already in progress may finish; it cannot recall emails already sent.

The activity panel shows recent updates. **Download Logs** exports the complete available results. Send history is normally kept for 30 days; saved campaigns remain until you delete them.

A successful result means Gmail accepted the message for sending. It does not guarantee delivery to the recipient's inbox. If a result is **unknown**, check your Gmail Sent folder before deciding whether to send that message again. MailStorm does not automatically resend messages whose outcome is uncertain.

## Troubleshooting

- **The CSV is rejected:** Check its `name` and `email` headers, complete every contact row, and stay within the displayed limits.
- **A template will not import:** For TXT, include both `Subject:` and `Body:` lines. For HTML, use a `.html` filename.
- **A placeholder is unmapped:** Open **Fields & preview** and select an existing CSV column for it, or remove it from the subject and body. Check mappings again after replacing the contact list.
- **Sending needs authorization:** Sign in with Google again to renew access.
- **Sending slows down or pauses:** Gmail may limit sending. MailStorm retries eligible temporary failures automatically; check the activity panel for the current status.
- **A saved campaign is missing:** Confirm that you signed in with the same Google account and that the campaign was saved before leaving the editor.

## Privacy and license

Read the [Privacy Policy](privacy-policy.md) for information about account and contact data. MailStorm is available under the [MIT License](LICENSE).
