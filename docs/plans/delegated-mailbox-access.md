# Plan: Delegated Mailbox Access

## Research Summary

### Can a delegate access a delegator's mailbox via Gmail API?

**No.** User-to-user Gmail delegation is a **web UI feature only**. The Gmail API does not support it.

Here's what the research confirmed:

1. **Gmail delegation (Settings → "Grant access to your account")** allows User A to grant User B access to their mailbox. Delegates can read, send, and delete messages - but **only through the Gmail web interface**.

2. **The Gmail API's `users.settings.delegates` resource** provides only four methods:
   - `create` - add a delegate
   - `delete` - remove a delegate
   - `get` - get delegate info
   - `list` - list delegates

   These methods **manage delegate settings** - they do NOT provide any way for a delegate to read/send emails via API. There is no endpoint like `users.messages.list` that accepts a "delegator" parameter.

3. **A delegate's OAuth token cannot access the delegator's mailbox.** The API simply doesn't support this. When you call `users.messages.list`, you can only access the mailbox of the authenticated user.

### What about domain-wide delegation?

Domain-wide delegation is a **completely different feature** that only works with:
- Google Workspace (not consumer Gmail)
- A service account with domain-wide authority granted by a Workspace admin
- The service account impersonates users directly - it doesn't use Gmail's delegation feature at all

With domain-wide delegation, you bypass user consent entirely. The service account can impersonate **any user** in the organization and make API calls as them. This is powerful but requires admin setup and is typically used for enterprise tools, backup solutions, or compliance.

## Implications for the Mail Client

### Consumer Gmail users
There is **no way** to programmatically access another user's mailbox. Each user must authenticate with their own OAuth credentials. If an EA needs to access their executive's inbox, the executive must add their own account to the app.

### Google Workspace users
Two options:

1. **Each user authenticates directly** (current approach) - Simple, works the same as consumer Gmail

2. **Domain-wide delegation with service account** - Would require:
   - Workspace admin to create and authorize a service account
   - The service account private key to be deployed with the app (security concern)
   - Admin to grant specific OAuth scopes to the service account
   - App to specify which user to impersonate for each request

## Recommendation

**Do not pursue delegate-based mailbox access** - the Gmail API doesn't support it.

If there's a real use case for EAs accessing executive inboxes:

1. **Short-term**: Have the executive add their own account to the app. The EA can switch between their account and the executive's account within the app.

2. **Long-term (enterprise only)**: If targeting Google Workspace organizations, consider adding service account support with domain-wide delegation. This would require:
   - Admin setup flow (or documentation)
   - Service account credential management
   - User impersonation logic in the Gmail client
   - Clear security documentation

## Sources

- [Managing Delegates | Gmail API](https://developers.google.com/workspace/gmail/api/guides/delegate_settings)
- [REST Resource: users.settings.delegates](https://developers.google.com/gmail/api/reference/rest/v1/users.settings.delegates)
- [Domain-wide delegation | Google Workspace Admin Help](https://support.google.com/a/answer/162106?hl=en)
- [Google Workspace Updates: Grant delegate access using Gmail API](https://workspaceupdates.googleblog.com/2018/10/gmail-api-delegate-access.html)
