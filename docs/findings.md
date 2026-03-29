# Findings: Independent Review of `testing-fixes` Branch

## Review assessment

The `testing-fixes` branch addresses real multi-account bugs in the mail client, and most of the fixes are well-executed. The core change — replacing the singleton `GmailClient` with an account-keyed `Map` and scoping DB reads to `accountId` — is correct and cleanly implemented. The OAuth cache-clear fix and archive-ready dismissed exclusion are also genuine bug fixes done properly.

However, the original engineer's analysis has two significant problems. First, severity calibration is off: enrichment JSON parsing and LinkedIn URL sanitization were both marked P1, but they are P2 at most — cosmetic or edge-case failures that do not cause data corruption or cross-account leakage. Second, and more importantly, the highest-severity bug on this branch was missed entirely: `gmail:create-draft` calls `getClient()` without an `accountId`, which means drafts created for a second account silently land in the default account's Gmail. This is the same class of bug as the `fetch-unread` issue but arguably worse, because it causes a user-visible write action in the wrong account. That bug is being fixed separately on this branch.

Additionally, the `resolveTargetAccountId` function introduced in the fixes silently falls back to the primary account when given an invalid ID. This prevents crashes, but it masks bugs: the caller believes it is operating on account X while actually hitting account Y. A logged warning before fallback would make this behavior observable and debuggable.

## Original issues and fixes (with corrected severity)

### P1 — Multi-account bleed in legacy fetch flow
- **What**: `gmail:fetch-unread` relied on a single hard-coded default client. Multi-account setups would fetch the wrong inbox.
- **Risk**: Wrong inbox data shown to user; credential context leaking across accounts.
- **Fix**: Fetch now resolves and uses the target account's client. DB reads/writes scoped to `accountId`.
- **Files**: `src/main/ipc/gmail.ipc.ts`, `src/main/db/index.ts`
- **Assessment**: Correct fix, correct severity. This was the right thing to prioritize.

### P1 — Dismissed archive-ready threads counted as analyzed
- **What**: `getAnalyzedArchiveThreadIds` did not exclude `dismissed=1` rows, so dismissed threads could be reprocessed or misclassified.
- **Risk**: Incorrect auto-archive behavior over time.
- **Fix**: Excluded dismissed rows from the query.
- **File**: `src/main/db/index.ts`
- **Assessment**: Real bug, correctly fixed.

### P2 — OAuth client cache stale reuse
- **What**: OAuth reconnect cleared only the `"default"` cache key, leaving stale clients for other accounts.
- **Risk**: Stale auth state causing unexpected account mismatch after reconnect.
- **Fix**: OAuth now clears the full cached client map.
- **File**: `src/main/ipc/gmail.ipc.ts`
- **Assessment**: Correct fix. Original severity of P2 was appropriate.

### P2 — Unvalidated requested account ID
- **What**: `gmail:fetch-unread` accepted any `accountId`, potentially creating empty or ghost client instances.
- **Risk**: Inconsistent UX and hard-to-debug fetch behavior.
- **Fix**: Invalid `accountId` now falls back to a configured account.
- **File**: `src/main/ipc/gmail.ipc.ts`
- **Assessment**: Reasonable fix. See design concern about silent fallback below.

### P2 — Enrichment JSON parsing (downgraded from P1)
- **What**: `JSON.parse` on enrichment payloads could throw on malformed rows.
- **Risk**: Profile panel fails to render for that specific email. Does not cause data corruption or cross-account issues.
- **Fix**: Malformed rows are now skipped with warning logs.
- **File**: `src/main/extensions/enrichment-store.ts`
- **Assessment**: Fine fix, but this is a cosmetic edge case. The original P1 classification overstated the impact.

### P2 — LinkedIn URL sanitization (downgraded from P1)
- **What**: Sender profile panel rendered `linkedinUrl` directly from enrichment data without scheme validation.
- **Risk**: Theoretically unsafe URL schemes could become clickable, but the data source is internal (Claude API output), not user-controlled. Low likelihood of exploitation.
- **Fix**: Only `http:` / `https:` links are now accepted.
- **File**: `src/renderer/extensions/bundled/SenderProfilePanel.tsx`
- **Assessment**: Defense-in-depth hardening, not a P1 vulnerability. Correctly fixed but miscategorized.

## Missed issues

### P1 — `gmail:create-draft` uses wrong account (CRITICAL)
- **What**: The `gmail:create-draft` IPC handler in `src/main/ipc/gmail.ipc.ts` calls `getClient()` with no `accountId`, always defaulting to `"default"`. When a user composes a draft for an email on their second account, the draft is created in the wrong Gmail account.
- **Risk**: User-visible write action in the wrong account. User thinks they are drafting in account B but the draft lands in account A. This is the same class of bug as the `fetch-unread` cross-account issue but with higher impact — reads show wrong data, but writes take wrong actions.
- **Status**: Being fixed on this branch by a separate change.

### Design concern — `resolveTargetAccountId` silent fallback (addressed)
- **What**: When given an invalid account ID, the function originally returned the primary account silently.
- **Risk**: Masks bugs. The caller proceeds believing it is operating on the requested account when it is actually hitting a different one.
- **Status**: Fixed on this branch — a `console.warn` is now logged before fallback, making the behavior observable. The fallback itself is kept for crash avoidance.

## Remaining issues (not addressed on this branch)

These are known multi-account scoping gaps that remain in the codebase:

1. **`prefetch-service.ts` calls `getInboxEmails()` without `accountId`** — The prefetch service mixes all accounts' emails into a single processing queue. Prefetch actions (analysis, sender lookup, auto-draft) may run against the wrong account's client.

2. **Renderer store uses `threadId` as key without account prefix** — `archiveReadyThreadIds` and `snoozedThreadIds` in the Zustand store are keyed by `threadId` alone. If two accounts have threads with the same ID (unlikely but possible with Gmail), they collide.

3. **Demo mode hardcodes `"default"` in `sync:get-emails`** — Demo/test mode bypasses account resolution entirely, making it impossible to test multi-account flows in demo mode.

4. **`sender_profiles` and `extension_enrichments` DB tables lack `account_id` column** — These tables are shared globally across accounts. A sender profile looked up in the context of account A will be served for account B, which is mostly harmless but architecturally inconsistent.

## Test coverage gaps

No new tests were added with these fixes. See [test-coverage-issues.md](./test-coverage-issues.md) for a detailed breakdown of missing coverage and suggested priority order. The highest-priority gaps are:
- Multi-account fetch dispatch and DB scoping tests
- Gmail client cache lifecycle tests
- Draft creation account routing tests (for the newly identified `create-draft` bug)
