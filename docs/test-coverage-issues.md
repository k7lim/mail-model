# Test Coverage Gaps (Current Branch: `testing-fixes`)

## What is currently covered conceptually
- Existing commit set focused on functional fixes and safety hardening; no new tests were added.

## Missing coverage to add next

- Multi-account fetch dispatch (`gmail:fetch-unread`)
  - Add tests for valid account requests, invalid account fallback, and default/empty account behavior.
  - Verify inbox rows written/read are scoped correctly by account in `getEmailIds` and `getInboxEmails`.

- Gmail client cache lifecycle
  - Test `gmail:start-oauth` clears all cached clients before reconnect.
  - Test that cached clients are reused per account after connect and not cross-linked.

- Enrichment JSON robustness
  - Add malformed payload cases for `getEnrichments` and `getEnrichmentBySender`.
  - Ensure bad rows are skipped, valid rows still resolve, and warning path is exercised.

- Sanitized profile link rendering
  - Add tests for `SenderProfilePanel` with valid `https://` and `http://` LinkedIn links.
  - Add negative cases for `javascript:` / `data:` / malformed URLs and assert link is not rendered.

- Archive-ready cache correctness
  - Add tests for `getAnalyzedArchiveThreadIds` to confirm dismissed items are excluded.
  - Add regression test where dismissed items should not block re-analysis/processing.

- IPC contract wiring
  - Add integration-style contract tests for `preload` and main IPC handler payload type/shape compatibility for `gmail:fetch-unread`.

## Suggested order
1. Account-scoped fetch + cache correctness tests (highest risk area).
2. Enrichment parse resilience.
3. Profile link sanitization.
4. IPC payload contract.
5. Archive cache regression.
