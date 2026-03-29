# Plan: Offline Sync

## Goal

Enable full offline functionality:
1. **Read** existing synced emails while offline (inbox only initially)
2. **Draft** emails while offline
3. **Send** replies that queue and send when connectivity returns

## Current State

**What we have:**
- Emails stored in SQLite with full body (`emails` table)
- `local_drafts` table exists (for compose)
- FTS5 search index works offline
- Sync service fetches from Gmail API

**What's missing:**
- No offline detection
- No outbox queue for pending sends
- No sync-on-reconnect logic
- No UI indicators for offline state
- Drafts currently require API call to create Gmail draft

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              APP                                         │
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │
│  │  NetworkMonitor │    │  SyncService    │    │  OutboxService  │      │
│  │                 │    │                 │    │                 │      │
│  │  - online/      │───►│  - Pauses when  │    │  - Queues sends │      │
│  │    offline      │    │    offline      │    │  - Retries on   │      │
│  │  - Events       │───►│  - Resumes on   │    │    reconnect    │      │
│  │                 │    │    reconnect    │    │                 │      │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘      │
│           │                                            │                 │
│           │              ┌─────────────────┐           │                 │
│           └─────────────►│   SQLite DB     │◄──────────┘                 │
│                          │                 │                             │
│                          │  emails         │  ← Read offline             │
│                          │  local_drafts   │  ← Draft offline            │
│                          │  outbox         │  ← Queue sends (NEW)        │
│                          │  sync_state     │  ← Track what's synced      │
│                          └─────────────────┘                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Network Monitoring

**New file: `src/main/services/network-monitor.ts`**

```typescript
import { net } from 'electron';
import { EventEmitter } from 'events';

class NetworkMonitor extends EventEmitter {
  private _isOnline: boolean = true;
  private checkInterval: NodeJS.Timeout | null = null;

  get isOnline(): boolean {
    return this._isOnline;
  }

  start() {
    // Initial check
    this._isOnline = net.isOnline();

    // Electron's net.isOnline() doesn't emit events, so poll
    this.checkInterval = setInterval(() => {
      const wasOnline = this._isOnline;
      this._isOnline = net.isOnline();

      if (wasOnline && !this._isOnline) {
        this.emit('offline');
      } else if (!wasOnline && this._isOnline) {
        this.emit('online');
      }
    }, 5000); // Check every 5 seconds
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

export const networkMonitor = new NetworkMonitor();
```

### Phase 2: Outbox Queue

**Schema addition:**

```sql
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL,              -- 'send' | 'reply' | 'draft_sync'
  thread_id TEXT,                  -- For replies
  to_addresses TEXT NOT NULL,      -- JSON array
  cc_addresses TEXT,               -- JSON array
  bcc_addresses TEXT,              -- JSON array
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  in_reply_to TEXT,                -- Message-ID header for threading
  references_header TEXT,          -- References header for threading
  status TEXT DEFAULT 'pending',   -- 'pending' | 'sending' | 'sent' | 'failed'
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
CREATE INDEX IF NOT EXISTS idx_outbox_account ON outbox(account_id);
```

**New file: `src/main/services/outbox-service.ts`**

```typescript
class OutboxService {
  private processing = false;

  // Queue a message for sending
  async queue(message: OutboxMessage): Promise<string> {
    const id = crypto.randomUUID();
    db.run(`
      INSERT INTO outbox (id, account_id, type, thread_id, to_addresses,
        cc_addresses, bcc_addresses, subject, body_html, body_text,
        in_reply_to, references_header, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `, [id, message.accountId, message.type, ...]);

    // Try to send immediately if online
    if (networkMonitor.isOnline) {
      this.processQueue();
    }

    return id;
  }

  // Process pending messages
  async processQueue() {
    if (this.processing || !networkMonitor.isOnline) return;
    this.processing = true;

    try {
      const pending = db.all(`
        SELECT * FROM outbox
        WHERE status = 'pending' OR (status = 'failed' AND retry_count < 3)
        ORDER BY created_at ASC
      `);

      for (const msg of pending) {
        await this.sendMessage(msg);
      }
    } finally {
      this.processing = false;
    }
  }

  private async sendMessage(msg: OutboxRow) {
    db.run(`UPDATE outbox SET status = 'sending' WHERE id = ?`, [msg.id]);

    try {
      const client = getGmailClient(msg.account_id);

      if (msg.type === 'reply' || msg.type === 'send') {
        await client.sendMessage({
          to: JSON.parse(msg.to_addresses),
          cc: msg.cc_addresses ? JSON.parse(msg.cc_addresses) : undefined,
          subject: msg.subject,
          bodyHtml: msg.body_html,
          bodyText: msg.body_text,
          threadId: msg.thread_id,
          inReplyTo: msg.in_reply_to,
          references: msg.references_header,
        });
      }

      db.run(`UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?`,
        [Date.now(), msg.id]);

      this.emit('messageSent', msg.id);

    } catch (error) {
      db.run(`
        UPDATE outbox
        SET status = 'failed', error_message = ?, retry_count = retry_count + 1
        WHERE id = ?
      `, [error.message, msg.id]);

      this.emit('messageFailed', msg.id, error);
    }
  }

  // Get outbox status for UI
  getStatus(): OutboxStatus {
    const counts = db.get(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'sending') as sending,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM outbox
    `);
    return counts;
  }
}

export const outboxService = new OutboxService();
```

### Phase 3: Offline-Aware Sync

**Modify `email-sync.ts`:**

```typescript
class EmailSyncService {
  // ... existing code ...

  constructor() {
    // Listen for network changes
    networkMonitor.on('offline', () => {
      console.log('[Sync] Went offline, pausing sync');
      this.pauseAllSync();
    });

    networkMonitor.on('online', () => {
      console.log('[Sync] Back online, resuming sync');
      this.resumeAllSync();
      outboxService.processQueue(); // Send queued messages
    });
  }

  private pauseAllSync() {
    for (const [accountId, account] of this.accounts) {
      if (account.intervalId) {
        clearInterval(account.intervalId);
        account.intervalId = null;
        account.status = 'offline';
        this.onSyncStatusChange?.(accountId, 'offline');
      }
    }
  }

  private resumeAllSync() {
    for (const accountId of this.accounts.keys()) {
      this.startSync(accountId);
    }
  }
}
```

### Phase 4: Offline Draft Handling

**Current `local_drafts` already supports this, but need to:**

1. Save drafts locally first (already happens)
2. Sync to Gmail when online (add background sync)
3. Handle conflicts (Gmail draft updated vs local)

```typescript
class DraftSyncService {
  // Sync local drafts to Gmail when online
  async syncDrafts(accountId: string) {
    if (!networkMonitor.isOnline) return;

    const unsynced = db.all(`
      SELECT * FROM local_drafts
      WHERE account_id = ? AND synced_at IS NULL
      ORDER BY updated_at ASC
    `, [accountId]);

    for (const draft of unsynced) {
      try {
        const client = getGmailClient(accountId);

        if (draft.gmail_draft_id) {
          // Update existing Gmail draft
          await client.updateDraft(draft.gmail_draft_id, { ... });
        } else {
          // Create new Gmail draft
          const result = await client.createFullDraft({ ... });
          db.run(`UPDATE local_drafts SET gmail_draft_id = ? WHERE id = ?`,
            [result.id, draft.id]);
        }

        db.run(`UPDATE local_drafts SET synced_at = ? WHERE id = ?`,
          [Date.now(), draft.id]);

      } catch (error) {
        console.error(`Failed to sync draft ${draft.id}:`, error);
      }
    }
  }
}
```

### Phase 5: UI Changes

**Renderer store additions:**

```typescript
interface AppState {
  // ... existing ...
  isOnline: boolean;
  outboxCount: number;  // Number of pending sends
}
```

**IPC events:**

```typescript
// Main → Renderer
ipcMain.handle('network:status', () => networkMonitor.isOnline);

// Notify renderer of status changes
networkMonitor.on('online', () => {
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send('network:online'));
});
networkMonitor.on('offline', () => {
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send('network:offline'));
});
```

**UI indicators:**

```
┌─────────────────────────────────────────────────────────────┐
│  [Offline Banner - shown when offline]                      │
│  ⚠️ You're offline. Changes will sync when reconnected.     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  [Status bar / footer]                                      │
│  📤 3 messages waiting to send                              │
└─────────────────────────────────────────────────────────────┘
```

## File Changes Summary

| File | Change |
|------|--------|
| `src/main/services/network-monitor.ts` | NEW - Network status monitoring |
| `src/main/services/outbox-service.ts` | NEW - Message queue for offline sends |
| `src/main/services/draft-sync.ts` | NEW - Background draft syncing |
| `src/main/services/email-sync.ts` | MODIFY - Pause/resume on network change |
| `src/main/db/schema.ts` | MODIFY - Add outbox table |
| `src/main/db/index.ts` | MODIFY - Add outbox CRUD functions |
| `src/main/ipc/sync.ipc.ts` | MODIFY - Add network status IPC |
| `src/main/ipc/drafts.ipc.ts` | MODIFY - Queue sends to outbox when offline |
| `src/renderer/store/index.ts` | MODIFY - Add isOnline, outboxCount state |
| `src/renderer/components/StatusBar.tsx` | NEW - Show offline/outbox status |
| `src/renderer/App.tsx` | MODIFY - Listen for network events, show banner |

## Edge Cases

1. **App starts offline**: Load from SQLite, show offline banner, skip sync
2. **Goes offline mid-sync**: Cancel in-progress requests, save partial state
3. **Send fails after retry limit**: Mark as failed, notify user, allow manual retry
4. **Draft conflict**: If Gmail draft was modified externally, prompt user (or last-write-wins)
5. **Token expired while offline**: Queue refresh, process outbox after re-auth

## Testing

1. Enable airplane mode, verify app loads and emails are readable
2. Compose reply while offline, verify it queues
3. Disable airplane mode, verify queued messages send
4. Kill network mid-sync, verify graceful handling
5. Stress test: queue 50 messages offline, verify all send on reconnect

## Implementation Order

1. Network monitor (foundation)
2. Outbox table + service (enables offline send)
3. Modify sync service for pause/resume
4. UI indicators (offline banner, outbox count)
5. Draft sync service (background sync drafts to Gmail)
6. Edge case handling + tests
