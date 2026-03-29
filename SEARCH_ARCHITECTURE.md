# Search Architecture: Research & Recommendations

## Current State

Search is **local-only**. The `emails:search` IPC handler queries a SQLite FTS5 index over the `emails` table. Only emails that have been synced to the local DB are searchable — currently just INBOX emails from the incremental sync. The background all-mail sync service (`background-sync.ts`) exists but is disabled (`email-sync.ts:7` — commented out, citing memory issues).

The Gmail API client already has `searchEmails(query)` and `searchAllEmails(query)` methods that call `messages.list` with the `q` parameter. These are unused during search.

## How Other Clients Handle Search

### Server-side search (Mimestream approach)

**Mimestream** is a macOS-native Gmail-only client built by a former Apple Mail engineer. It uses the Gmail API exclusively (no IMAP) and delegates all search to the Gmail API's `messages.list` with `q`. No local FTS index at all.

- Pros: Zero storage overhead, instant account setup, search always covers full mailbox, no index maintenance
- Cons: No offline search, depends on network latency (~200-800ms per query)
- Best for: Gmail-only clients that prioritize simplicity

### Local-first search (Superhuman approach)

**Superhuman** syncs emails to browser WebSQL storage and runs a custom FTS3-backed query compiler locally. A four-phase compiler (tokenize → node generation → AST → SQL) handles Gmail-style operators. For queries outside the local cache, falls back to server-side.

**Thunderbird** uses Gloda, a SQLite FTS3-based global index. Only indexes bodies of messages marked for offline availability. Known issues with Gmail: duplicate results from All Mail folder, slow initial indexing.

**Apple Mail** downloads everything via IMAP and indexes with Spotlight/CoreSpotlight. Notoriously unreliable for Gmail — sync issues, duplicate messages, index corruption requiring multi-hour rebuilds.

- Pros: Sub-millisecond query latency, works offline, no per-query API cost
- Cons: Slow initial sync (minutes to hours), 1-4GB storage for 100k emails, index maintenance (VACUUM/OPTIMIZE), incomplete until sync finishes

### Server-dependent (Spark, Edison)

**Spark** routes email through its own servers, caches ~1 month locally, delegates search to the IMAP server / Gmail. **Edison Mail** similarly processes on their servers with AI-powered search. Both trade privacy for convenience.

### Hybrid (what we should do)

**Mailspring** (open source Electron app) takes a pragmatic middle ground: syncs last 3 months of bodies locally with SQLite FTS, older emails get headers only. Local search covers recent mail, older mail searchable by metadata.

## Recommended Architecture

A two-phase hybrid: show local results instantly, then augment with Gmail API results.

```
User types query
    │
    ├─ Immediate: local FTS5 search (current behavior, <10ms)
    │   → show results instantly
    │
    └─ Async: Gmail API messages.list with q parameter (~200-800ms)
        → fetch message details for results not in local DB
        → merge into results, deduplicate by message ID
        → cache fetched emails in local DB (populates FTS via triggers)
```

### Phase 1: Gmail API remote search (this is the priority)

When `performFullSearch` fires (user presses Enter), do both:
1. Local FTS5 query (instant) — show these results immediately
2. Gmail API `messages.list` with `q` parameter — when results arrive, fetch full details for any message IDs not in local DB via `messages.get`, save to DB (which auto-indexes via FTS triggers), merge into results

This gives comprehensive search without requiring background sync of all mail. The Gmail API search is the same engine powering the Gmail web UI — it searches the full mailbox including body text, attachments by name, and supports all Gmail operators.

Key implementation details:
- `messages.list` returns only `{id, threadId}` pairs — need `messages.get` for each to get full content
- Deduplicate by Gmail message ID (stable, globally unique)
- Rate limit: 15,000 quota units/user/minute. `messages.list` costs 5 units, `messages.get` costs 5 units. A search returning 50 results = 5 + (50 * 5) = 255 units — well within limits
- Use batch API for fetching multiple messages (up to 100 per HTTP request)

### Phase 2: Background all-mail sync (future improvement)

Re-enable and fix the background sync service to progressively sync all mail to local DB. This makes the local FTS5 results more comprehensive over time, reducing reliance on the Gmail API for subsequent searches.

Key considerations:
- For 100k emails at 5 quota units each: ~33 minutes minimum at rate limit
- Sync most recent first (last 30 days, then backfill)
- Batch API to reduce HTTP overhead
- The memory issue that caused it to be disabled needs investigation — likely from fetching too many full messages concurrently

### Phase 3: Incremental search index (optional)

As the user searches and we fetch remote results, those emails get cached locally. Over time, the local FTS index becomes increasingly comprehensive for the user's actual search patterns — a natural "search-driven sync" that prioritizes relevance over completeness.

## Gmail API Rate Limits Reference

| Method | Quota Units | Per-User Limit |
|--------|------------|----------------|
| `messages.list` | 5 | 15,000 units/min |
| `messages.get` | 5 | (~250 requests/sec burst) |
| `messages.send` | 100 | |
| `history.list` | 2 | |
| Batch request | Sum of individual costs | Max 100 per batch |

## What We're NOT Doing

- **IMAP search**: Gmail API is strictly superior for Gmail accounts. IMAP SEARCH is folder-scoped, doesn't support Gmail operators, and has worse full-text search.
- **Xapian/Lucene**: FTS5 is sufficient for our scale. Xapian has better ranking (BM25) but adds a C++ dependency.
- **Server-side intermediary** (Spark/Edison model): Privacy concerns, infrastructure cost, and unnecessary for a single-user desktop client.
