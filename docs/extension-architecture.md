# Extension Architecture

A plugin system for the mail client that allows third-party developers to enrich emails with external context (CRM systems, LinkedIn, Salesforce, etc.), add UI panels, and integrate with external services.

## Design Goals

1. **Simple to build**: Extensions are npm packages with React components
2. **Familiar patterns**: Similar to VS Code extensions, but simpler
3. **Works with existing code**: Integrates naturally with React + Zustand
4. **Grows with the project**: Start simple, add isolation later if needed

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              MAIL CLIENT                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   MAIN PROCESS                              RENDERER PROCESS                     │
│  ┌────────────────────┐                    ┌────────────────────────────────┐   │
│  │                    │                    │                                │   │
│  │  Extension Host    │◄──── IPC ─────────►│  Extension UI Manager          │   │
│  │  - Loads manifests │                    │  - Loads React components      │   │
│  │  - Manages auth    │                    │  - Renders sidebar panels      │   │
│  │  - Runs enrichment │                    │  - Shows badges                │   │
│  │  - Proxies network │                    │                                │   │
│  │                    │                    │  Your App (React + Zustand)    │   │
│  │  Gmail Service     │                    │  - EmailDetail.tsx             │   │
│  │  SQLite DB         │                    │  - SenderProfilePanel ──────┐  │   │
│  │  Claude API        │                    │  - Extension panels ────────┼──┤   │
│  │                    │                    │                             │  │   │
│  └────────────────────┘                    └─────────────────────────────┼──┘   │
│                                                                          │      │
│                                            Extension sidebar slots ◄─────┘      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Where Code Runs

| Code | Process | Why |
|------|---------|-----|
| Extension manifest loading | Main | Happens at startup |
| Enrichment providers (API calls) | Main | Access to network, DB, secrets |
| WebView auth flows | Main | Separate BrowserWindow |
| Extension React components | Renderer | Part of your React app |

For v1, extension code runs **in-process** (no worker isolation). This is simpler and lets extensions directly use your React components and Zustand store patterns.

---

## Extension Structure

An extension is an npm package with this structure:

```
mail-ext-crm/
├── package.json          # Manifest with "mailExtension" field
├── src/
│   ├── index.ts          # Main entry: activate(), deactivate()
│   └── components/       # React components for UI
│       └── CRMInfoPanel.tsx
├── assets/
│   └── crm-logo.svg
└── dist/                 # Built output
    ├── index.js
    └── index.d.ts
```

### package.json Manifest

```json
{
  "name": "mail-ext-crm",
  "version": "1.0.0",
  "main": "./dist/index.js",

  "mailExtension": {
    "id": "crm-integration",
    "displayName": "CRM Integration",
    "description": "Enrich emails with CRM contact and company information",

    "activationEvents": ["onEmail"],

    "contributes": {
      "sidebarPanels": [{
        "id": "crm-info",
        "title": "CRM Info",
        "icon": "./assets/crm-logo.svg"
      }],

      "emailBadges": [{
        "id": "contact-badge"
      }],

      "settings": [{
        "id": "showBatch",
        "type": "boolean",
        "default": true,
        "title": "Show account tier in badge"
      }]
    },

    "authentication": [{
      "id": "crm",
      "type": "webview",
      "label": "Sign in to CRM",
      "loginUrl": "https://crm.example.com",
      "domains": ["crm.example.com", "auth.example.com"],
      "successWhen": "window.AlgoliaOpts && window.AlgoliaOpts.key",
      "extract": {
        "algoliaApp": "window.AlgoliaOpts.app",
        "algoliaKey": "window.AlgoliaOpts.key"
      }
    }]
  },

  "peerDependencies": {
    "@anthropic-ai/mail-client-extension-api": "^1.0.0"
  }
}
```

### Manifest Fields

| Field | Description |
|-------|-------------|
| `mailExtension.id` | Unique identifier (lowercase, hyphens only) |
| `activationEvents` | When to load: `onStartup`, `onEmail`, `onEmail:domain:x.com` |
| `contributes.sidebarPanels` | Panels shown in the right sidebar |
| `contributes.emailBadges` | Badges shown on emails in the list |
| `contributes.settings` | User-configurable settings |
| `authentication` | Auth flows the extension needs (see WebView Auth below) |

---

## Extension API

Extensions receive an API object when activated:

```typescript
// Extension entry point
import type { ExtensionContext, ExtensionAPI } from '@anthropic-ai/mail-client-extension-api';

export async function activate(ctx: ExtensionContext, api: ExtensionAPI) {
  // Register providers, set up listeners
}

export function deactivate() {
  // Cleanup
}
```

### ExtensionContext

```typescript
interface ExtensionContext {
  // Extension metadata
  extensionId: string;
  extensionPath: string;  // Absolute path to extension directory

  // Disposables - automatically cleaned up on deactivate
  subscriptions: Disposable[];

  // Persistent key-value storage
  storage: {
    get<T>(key: string, defaultValue?: T): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // Encrypted secrets storage (uses Electron safeStorage)
  secrets: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // Logging (goes to extension log file + dev console)
  log: {
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
  };
}
```

### ExtensionAPI

```typescript
interface ExtensionAPI {
  // ═══════════════════════════════════════════════════════════════════
  // EMAIL ACCESS
  // ═══════════════════════════════════════════════════════════════════

  emails: {
    // Get the currently viewed email
    getActiveEmail(): Email | undefined;

    // Get email by ID
    getEmail(id: string): Promise<Email | undefined>;

    // Events
    onDidViewEmail: Event<Email>;
    onDidReceiveEmail: Event<Email>;
  };

  // ═══════════════════════════════════════════════════════════════════
  // ENRICHMENT (the main thing extensions do)
  // ═══════════════════════════════════════════════════════════════════

  enrichment: {
    // Register your extension as an enrichment provider
    registerProvider(provider: EnrichmentProvider): Disposable;

    // Get all enrichment data for an email
    getEnrichments(emailId: string): EnrichmentData[];

    // Events
    onDidEnrich: Event<{ emailId: string; data: EnrichmentData }>;
  };

  // ═══════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════

  auth: {
    // Check if authenticated for a given auth config
    isAuthenticated(authId: string): Promise<boolean>;

    // Get stored session (cookies, extracted values)
    getSession(authId: string): Promise<AuthSession | undefined>;

    // Trigger auth flow (opens WebView window)
    requestAuth(authId: string): Promise<AuthSession>;

    // Clear stored auth
    signOut(authId: string): Promise<void>;

    // Events
    onDidAuthenticate: Event<{ authId: string }>;
    onDidSessionExpire: Event<{ authId: string }>;
  };

  // ═══════════════════════════════════════════════════════════════════
  // NETWORK (all requests go through this for auditing)
  // ═══════════════════════════════════════════════════════════════════

  network: {
    // Basic fetch
    fetch(url: string, options?: RequestInit): Promise<Response>;

    // Fetch with automatic cookie injection from auth session
    fetchWithSession(authId: string, url: string, options?: RequestInit): Promise<Response>;
  };

  // ═══════════════════════════════════════════════════════════════════
  // UI
  // ═══════════════════════════════════════════════════════════════════

  ui: {
    // Register React component for a sidebar panel
    registerSidebarPanel(
      panelId: string,
      component: React.ComponentType<SidebarPanelProps>
    ): Disposable;

    // Register badge provider
    registerBadgeProvider(
      badgeId: string,
      provider: BadgeProvider
    ): Disposable;

    // Show notifications
    showInfo(message: string): void;
    showError(message: string): void;
    showWarning(message: string): void;
  };

  // ═══════════════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════════════

  settings: {
    get<T>(settingId: string): T;
    onDidChange: Event<{ settingId: string; value: any }>;
  };
}
```

### Key Types

```typescript
interface Email {
  id: string;
  threadId: string;
  accountId: string;
  from: string;       // "John Smith <john@example.com>"
  to: string;
  cc?: string;
  subject: string;
  body: string;       // May be HTML
  snippet: string;
  date: string;
  labels: string[];
}

interface EnrichmentProvider {
  id: string;

  // Called when an email is viewed - should you enrich it?
  canEnrich(email: Email): Promise<boolean>;

  // Called to get enrichment data
  enrich(email: Email): Promise<EnrichmentData | null>;
}

interface EnrichmentData {
  source: string;        // Your extension ID
  data: Record<string, any>;  // Arbitrary data your UI component will receive
  expiresAt?: number;    // Cache expiration (ms since epoch)
}

interface SidebarPanelProps {
  email: Email;
  enrichment: EnrichmentData | null;  // Your enrichment data, if any
}

interface BadgeProvider {
  // Return badge config, or null to not show badge
  getBadge(email: Email, enrichment: EnrichmentData | null): Badge | null;
}

interface Badge {
  text: string;
  color?: 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'orange';
  tooltip?: string;
}

interface AuthSession {
  authId: string;
  isValid: boolean;
  cookies: { name: string; value: string; domain: string }[];
  extracted: Record<string, any>;  // Values from `extract` config
  expiresAt?: number;
}
```

---

## WebView Authentication

This is the key pattern for integrating with services like a CRM that don't have public APIs.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         WEBVIEW AUTH FLOW                                        │
└─────────────────────────────────────────────────────────────────────────────────┘

1. Extension calls: await api.auth.requestAuth('crm')

2. Mail client opens a new BrowserWindow:

   ┌─────────────────────────────────────────────────────────────┐
   │  Sign in to CRM                              [X]   │
   ├─────────────────────────────────────────────────────────────┤
   │                                                             │
   │   ┌─────────────────────────────────────────────────────┐   │
   │   │                                                     │   │
   │   │            CRM Login Page                        │   │
   │   │                                                     │   │
   │   │    Email: [_________________________]               │   │
   │   │                                                     │   │
   │   │    [Continue with Google]                           │   │
   │   │                                                     │   │
   │   └─────────────────────────────────────────────────────┘   │
   │                                                             │
   │   This extension is requesting access to:                   │
   │   • crm.example.com                                │
   │   • auth.example.com                                 │
   │                                                             │
   └─────────────────────────────────────────────────────────────┘

3. User completes login (SSO, OAuth, whatever the site uses)

4. Mail client polls for success condition:
   - Runs: window.AlgoliaOpts && window.AlgoliaOpts.key
   - When truthy, auth succeeded

5. Mail client extracts configured values:
   - algoliaApp = window.AlgoliaOpts.app
   - algoliaKey = window.AlgoliaOpts.key

6. Mail client stores session:
   - Cookies for configured domains → encrypted storage
   - Extracted values → extension secrets

7. Returns AuthSession to extension

8. Extension uses the credentials:
   - session.extracted.algoliaKey for Algolia searches
   - api.network.fetchWithSession('crm', url) for authenticated requests
```

### Auth Configuration

In your extension's `package.json`:

```json
{
  "mailExtension": {
    "authentication": [{
      "id": "crm",
      "type": "webview",
      "label": "Sign in to CRM",

      "loginUrl": "https://crm.example.com",

      "domains": [
        "crm.example.com",
        "auth.example.com"
      ],

      "successWhen": "window.AlgoliaOpts && window.AlgoliaOpts.key",

      "extract": {
        "algoliaApp": "window.AlgoliaOpts.app",
        "algoliaKey": "window.AlgoliaOpts.key"
      },

      "sessionCheck": {
        "url": "https://crm.example.com",
        "interval": 3600000,
        "validWhen": "!!window.AlgoliaOpts"
      }
    }]
  }
}
```

| Field | Description |
|-------|-------------|
| `loginUrl` | Initial URL to load |
| `domains` | Domains to capture cookies for |
| `successWhen` | JS expression that returns truthy when auth is complete |
| `extract` | JS expressions to extract values (stored in `session.extracted`) |
| `sessionCheck` | Optional: periodically verify session is still valid |

---

## UI Integration

Extensions provide React components that render in designated slots.

### Sidebar Panels

Your existing `SenderProfilePanel` is a perfect example of what extension panels look like. Extensions register similar components:

```typescript
// In extension's activate()
api.ui.registerSidebarPanel('crm-info', CRMInfoPanel);
```

```tsx
// CRMInfoPanel.tsx
import type { SidebarPanelProps } from '@anthropic-ai/mail-client-extension-api';

export function CRMInfoPanel({ email, enrichment }: SidebarPanelProps) {
  if (!enrichment) {
    return null;  // Don't render if no CRM data for this email
  }

  const { name, company, batch, avatarUrl, profileUrl } = enrichment.data;

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        {avatarUrl ? (
          <img src={avatarUrl} className="w-12 h-12 rounded-full" alt={name} />
        ) : (
          <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center">
            <span className="text-orange-600 font-semibold text-lg">
              {name?.charAt(0)}
            </span>
          </div>
        )}
        <div>
          <div className="font-semibold text-gray-900">{name}</div>
          {batch && (
            <div className="text-sm text-orange-600 font-medium">Account tier</div>
          )}
        </div>
      </div>

      {/* Company */}
      {company && (
        <div className="border-t pt-4">
          <div className="text-xs font-medium text-gray-500 uppercase mb-1">
            Company
          </div>
          <div className="font-medium text-gray-900">{company}</div>
        </div>
      )}

      {/* Link */}
      <div className="border-t pt-4 mt-4">
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          View in CRM →
        </a>
      </div>
    </div>
  );
}
```

### Email Badges

Badges appear in the email list next to sender names:

```typescript
api.ui.registerBadgeProvider('contact-badge', {
  getBadge(email, enrichment) {
    if (!enrichment) return null;

    const { batch } = enrichment.data;
    return {
      text: tier ? `${tier}` : 'Contact',
      color: 'orange',
      tooltip: `Contact - ${enrichment.data.company}`
    };
  }
});
```

### How It Fits With Your Code

Your `EmailDetail.tsx` currently has `SenderProfilePanel` hardcoded. With extensions:

```tsx
// EmailDetail.tsx (modified)
import { useExtensionPanels } from '../extensions/hooks';

export function EmailDetail() {
  const { panels } = useExtensionPanels(selectedEmail);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* ... existing thread view ... */}
      </div>

      {/* Sidebar - extension panels */}
      <div className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
        {/* Built-in sender panel (could also be an extension) */}
        <SenderProfilePanel email={latestEmail} threadEmails={threadEmails} />

        {/* Extension panels */}
        {panels.map(panel => (
          <div key={panel.id} className="border-t">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 uppercase">
                {panel.title}
              </h3>
            </div>
            <panel.component
              email={latestEmail}
              enrichment={panel.enrichment}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Bundled Extension: Web Search (Migration from Existing Code)

The existing `SenderProfilePanel` with web search functionality should be migrated to an extension. This:
- Validates the extension architecture with a real use case
- Keeps the core client minimal (no enrichment logic baked in)
- Serves as a reference implementation for extension authors
- Lets users disable/enable web search if desired

### Current State (Hardcoded)

```
src/renderer/components/
├── EmailDetail.tsx          ← imports SenderProfilePanel directly
├── SenderProfilePanel.tsx   ← web search logic baked in
└── ...
```

### Target State (Extension-based)

```
Core client (open source)              Bundled extension (also open source)
─────────────────────────              ─────────────────────────────────────
src/renderer/components/               mail-ext-web-search/
├── EmailDetail.tsx                    ├── package.json
│   └── renders ExtensionPanelSlot     ├── src/
└── (no enrichment logic)              │   ├── index.ts
                                       │   ├── web-search.ts (existing logic)
                                       │   └── components/
                                       │       └── SenderProfilePanel.tsx
                                       └── dist/
```

### mail-ext-web-search/package.json

```json
{
  "name": "mail-ext-web-search",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "description": "Web search enrichment for email senders",

  "mailExtension": {
    "id": "web-search",
    "displayName": "Sender Web Search",
    "description": "Search the web for information about email senders",
    "builtIn": true,

    "activationEvents": ["onEmail"],

    "contributes": {
      "sidebarPanels": [{
        "id": "sender-profile",
        "title": "Sender Profile",
        "icon": "./assets/search-icon.svg",
        "priority": 100
      }],
      "emailBadges": [{
        "id": "sender-company"
      }],
      "settings": [{
        "id": "enabled",
        "type": "boolean",
        "default": true,
        "title": "Enable web search for senders"
      }, {
        "id": "searchEngine",
        "type": "select",
        "default": "duckduckgo",
        "options": ["duckduckgo", "google", "bing"],
        "title": "Search engine to use"
      }]
    }
  },

  "peerDependencies": {
    "@anthropic-ai/mail-client-extension-api": "^1.0.0",
    "react": "^18.0.0"
  }
}
```

### mail-ext-web-search/src/index.ts

```typescript
import type {
  ExtensionContext,
  ExtensionAPI,
  Email,
  EnrichmentData
} from '@anthropic-ai/mail-client-extension-api';
import { searchWeb, WebSearchResult } from './web-search';
import { SenderProfilePanel } from './components/SenderProfilePanel';

let ctx: ExtensionContext;
let api: ExtensionAPI;
const cache = new Map<string, EnrichmentData | null>();

export async function activate(context: ExtensionContext, extensionApi: ExtensionAPI) {
  ctx = context;
  api = extensionApi;

  ctx.log.info('Web Search extension activating...');

  // Register enrichment provider
  ctx.subscriptions.push(
    api.enrichment.registerProvider({
      id: 'web-search',

      async canEnrich(email: Email) {
        const enabled = api.settings.get<boolean>('enabled');
        return enabled !== false;
      },

      async enrich(email: Email) {
        return lookupSender(email);
      }
    })
  );

  // Register UI
  ctx.subscriptions.push(
    api.ui.registerSidebarPanel('sender-profile', SenderProfilePanel)
  );

  ctx.subscriptions.push(
    api.ui.registerBadgeProvider('sender-company', {
      getBadge(email, enrichment) {
        if (!enrichment?.data?.company) return null;

        return {
          text: enrichment.data.company,
          color: 'gray',
          tooltip: enrichment.data.title
            ? `${enrichment.data.title} at ${enrichment.data.company}`
            : enrichment.data.company
        };
      }
    })
  );

  ctx.log.info('Web Search extension activated');
}

export function deactivate() {
  cache.clear();
}

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function extractName(from: string): string {
  const match = from.match(/^([^<]+)</);
  return match ? match[1].trim() : from.split('@')[0];
}

async function lookupSender(email: Email): Promise<EnrichmentData | null> {
  const senderEmail = extractEmail(email.from);

  // Check cache
  if (cache.has(senderEmail)) {
    return cache.get(senderEmail) ?? null;
  }

  const senderName = extractName(email.from);
  const searchEngine = api.settings.get<string>('searchEngine') || 'duckduckgo';

  try {
    const results = await searchWeb(senderName, senderEmail, { engine: searchEngine });

    if (!results) {
      cache.set(senderEmail, null);
      return null;
    }

    const enrichment: EnrichmentData = {
      source: 'web-search',
      data: {
        name: senderName,
        email: senderEmail,
        company: results.company,
        title: results.title,
        linkedInUrl: results.linkedInUrl,
        twitterUrl: results.twitterUrl,
        bio: results.bio,
        avatarUrl: results.avatarUrl,
      },
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000  // 7 days
    };

    cache.set(senderEmail, enrichment);
    return enrichment;

  } catch (error) {
    ctx.log.error('Web search failed', error);
    return null;
  }
}
```

### mail-ext-web-search/src/components/SenderProfilePanel.tsx

This is essentially the existing `SenderProfilePanel.tsx` moved into the extension, with props changed to match `SidebarPanelProps`:

```tsx
import React from 'react';
import type { SidebarPanelProps } from '@anthropic-ai/mail-client-extension-api';

export function SenderProfilePanel({ email, enrichment }: SidebarPanelProps) {
  if (!enrichment) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        <div className="animate-pulse">Searching...</div>
      </div>
    );
  }

  const { name, email: senderEmail, company, title, linkedInUrl, twitterUrl, bio, avatarUrl } = enrichment.data;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="w-12 h-12 rounded-full bg-gray-200" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
            <span className="text-blue-600 font-semibold text-lg">
              {name?.charAt(0)?.toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 truncate">{name}</div>
          <div className="text-sm text-gray-500 truncate">{senderEmail}</div>
        </div>
      </div>

      {/* Company & Title */}
      {(company || title) && (
        <div className="border-t pt-4">
          {title && <div className="text-sm text-gray-900">{title}</div>}
          {company && <div className="text-sm text-gray-600">{company}</div>}
        </div>
      )}

      {/* Bio */}
      {bio && (
        <div className="border-t pt-4">
          <div className="text-sm text-gray-700 line-clamp-3">{bio}</div>
        </div>
      )}

      {/* Links */}
      {(linkedInUrl || twitterUrl) && (
        <div className="border-t pt-4 flex gap-3">
          {linkedInUrl && (
            <a
              href={linkedInUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              LinkedIn
            </a>
          )}
          {twitterUrl && (
            <a
              href={twitterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Twitter
            </a>
          )}
        </div>
      )}
    </div>
  );
}
```

### Core Client After Migration

The `EmailDetail.tsx` becomes agnostic to what panels exist:

```tsx
// src/renderer/components/EmailDetail.tsx

import { useExtensionPanels } from '../extensions/hooks';

export function EmailDetail() {
  const selectedEmail = useAppStore((state) => /* ... */);
  const { panels, isLoading } = useExtensionPanels(selectedEmail);

  if (!selectedEmail) {
    return <div className="flex-1 flex items-center justify-center">...</div>;
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main email content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Thread view, email body, draft panel, etc. */}
      </div>

      {/* Sidebar - ALL panels come from extensions */}
      {panels.length > 0 && (
        <div className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-y-auto">
          {panels
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
            .map(panel => (
              <div key={panel.id} className="border-b border-gray-200">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {panel.title}
                  </h3>
                </div>
                <panel.component
                  email={selectedEmail}
                  enrichment={panel.enrichment}
                />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
```

### Migration Checklist

- [ ] Create `mail-ext-web-search/` package structure
- [ ] Move web search logic from main codebase to extension
- [ ] Move `SenderProfilePanel.tsx` to extension, adapt to `SidebarPanelProps`
- [ ] Implement `useExtensionPanels` hook in core client
- [ ] Update `EmailDetail.tsx` to use extension panels
- [ ] Add `mail-ext-web-search` as a bundled dependency (installed by default)
- [ ] Test that existing functionality works identically

---

## Complete Example: CRM Integration Extension

### package.json

```json
{
  "name": "mail-ext-crm",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",

  "mailExtension": {
    "id": "crm-integration",
    "displayName": "CRM Integration",
    "description": "See contact info for email senders",

    "activationEvents": ["onEmail"],

    "contributes": {
      "sidebarPanels": [{
        "id": "crm-info",
        "title": "CRM Info",
        "icon": "./assets/crm-logo.svg"
      }],
      "emailBadges": [{
        "id": "contact-badge"
      }],
      "settings": [{
        "id": "showBatch",
        "type": "boolean",
        "default": true,
        "title": "Show batch in badge"
      }]
    },

    "authentication": [{
      "id": "crm",
      "type": "webview",
      "label": "Sign in to CRM",
      "loginUrl": "https://crm.example.com",
      "domains": ["crm.example.com", "auth.example.com"],
      "successWhen": "window.AlgoliaOpts && window.AlgoliaOpts.key",
      "extract": {
        "algoliaApp": "window.AlgoliaOpts.app",
        "algoliaKey": "window.AlgoliaOpts.key"
      }
    }]
  },

  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsup src/index.ts --format esm --dts --watch"
  },

  "dependencies": {
    "algoliasearch": "^4.20.0"
  },

  "peerDependencies": {
    "@anthropic-ai/mail-client-extension-api": "^1.0.0",
    "react": "^18.0.0"
  }
}
```

### src/index.ts

```typescript
import type {
  ExtensionContext,
  ExtensionAPI,
  Email,
  EnrichmentData
} from '@anthropic-ai/mail-client-extension-api';
import algoliasearch, { SearchIndex } from 'algoliasearch';
import { CRMInfoPanel } from './components/CRMInfoPanel';

let ctx: ExtensionContext;
let api: ExtensionAPI;
let algoliaIndex: SearchIndex | null = null;
const cache = new Map<string, EnrichmentData | null>();

export async function activate(context: ExtensionContext, extensionApi: ExtensionAPI) {
  ctx = context;
  api = extensionApi;

  ctx.log.info('CRM extension activating...');

  // Initialize Algolia if already authenticated
  const session = await api.auth.getSession('crm');
  if (session?.isValid) {
    initAlgolia(session.extracted);
  }

  // Register enrichment provider
  ctx.subscriptions.push(
    api.enrichment.registerProvider({
      id: 'crm-integration',

      async canEnrich(email: Email) {
        // Try to enrich all emails (we'll filter by email match)
        return await api.auth.isAuthenticated('crm');
      },

      async enrich(email: Email) {
        return lookupFounder(extractEmail(email.from));
      }
    })
  );

  // Register UI
  ctx.subscriptions.push(
    api.ui.registerSidebarPanel('crm-info', CRMInfoPanel)
  );

  ctx.subscriptions.push(
    api.ui.registerBadgeProvider('contact-badge', {
      getBadge(email, enrichment) {
        if (!enrichment) return null;

        const showBatch = api.settings.get<boolean>('showBatch');
        const { batch, company } = enrichment.data;

        return {
          text: showBatch && tier ? `${tier}` : 'Contact',
          color: 'orange',
          tooltip: company ? `${company} - ${tier}` : `${tier}`
        };
      }
    })
  );

  // Listen for auth changes
  ctx.subscriptions.push(
    api.auth.onDidAuthenticate(({ authId }) => {
      if (authId === 'crm') {
        api.auth.getSession('crm').then(session => {
          if (session) initAlgolia(session.extracted);
        });
      }
    })
  );

  ctx.subscriptions.push(
    api.auth.onDidSessionExpire(({ authId }) => {
      if (authId === 'crm') {
        algoliaIndex = null;
        cache.clear();
        api.ui.showWarning('CRM session expired. Please sign in again.');
      }
    })
  );

  ctx.log.info('CRM extension activated');
}

export function deactivate() {
  algoliaIndex = null;
  cache.clear();
}

function initAlgolia(extracted: Record<string, any>) {
  const { algoliaApp, algoliaKey } = extracted;
  if (!algoliaApp || !algoliaKey) {
    ctx.log.error('Missing Algolia credentials');
    return;
  }

  const client = algoliasearch(algoliaApp, algoliaKey);
  algoliaIndex = client.initIndex('Users_production');
  ctx.log.info('Algolia initialized');
}

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

async function lookupFounder(email: string): Promise<EnrichmentData | null> {
  // Check cache
  if (cache.has(email)) {
    return cache.get(email) ?? null;
  }

  // Ensure we have Algolia
  if (!algoliaIndex) {
    const session = await api.auth.getSession('crm');
    if (!session?.isValid) {
      // Prompt user to authenticate
      try {
        const newSession = await api.auth.requestAuth('crm');
        initAlgolia(newSession.extracted);
      } catch {
        return null;
      }
    } else {
      initAlgolia(session.extracted);
    }
  }

  if (!algoliaIndex) return null;

  try {
    const results = await algoliaIndex.search(email, {
      hitsPerPage: 1,
      attributesToRetrieve: [
        'id', 'first_name', 'last_name', 'email', 'hnid',
        'avatar_thumb', 'current_company', 'batches'
      ]
    });

    if (results.hits.length === 0) {
      cache.set(email, null);
      return null;
    }

    const hit = results.hits[0] as any;

    // Verify email matches (Algolia does fuzzy matching)
    if (hit.email?.toLowerCase() !== email.toLowerCase()) {
      cache.set(email, null);
      return null;
    }

    const enrichment: EnrichmentData = {
      source: 'crm-integration',
      data: {
        id: hit.id,
        hnid: hit.hnid,
        name: `${hit.first_name} ${hit.last_name}`,
        email: hit.email,
        avatarUrl: hit.avatar_thumb,
        company: hit.current_company,
        batch: hit.batches?.[0],
        profileUrl: `https://crm.example.com/contact/${hit.id}`
      },
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000  // 7 days
    };

    cache.set(email, enrichment);
    return enrichment;

  } catch (error) {
    ctx.log.error('Algolia lookup failed', error);
    return null;
  }
}
```

### src/components/CRMInfoPanel.tsx

```tsx
import React from 'react';
import type { SidebarPanelProps } from '@anthropic-ai/mail-client-extension-api';

export function CRMInfoPanel({ email, enrichment }: SidebarPanelProps) {
  if (!enrichment) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        No contact info found
      </div>
    );
  }

  const { name, avatarUrl, company, batch, profileUrl } = enrichment.data;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            className="w-12 h-12 rounded-full bg-gray-200"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center">
            <span className="text-orange-600 font-semibold text-lg">
              {name?.charAt(0)}
            </span>
          </div>
        )}
        <div>
          <div className="font-semibold text-gray-900">{name}</div>
          {batch && (
            <div className="text-sm text-orange-600 font-medium">
              Account tier
            </div>
          )}
        </div>
      </div>

      {/* Company */}
      {company && (
        <div className="border-t pt-4">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Company
          </div>
          <div className="font-medium text-gray-900">{company}</div>
        </div>
      )}

      {/* Link */}
      <div className="border-t pt-4">
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          View in CRM
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>
  );
}
```

---

## Installation & Distribution

### Installing Extensions

Extensions are npm packages. Users install them via:

```bash
# CLI
mail-app install mail-ext-crm

# Or in the app's extension manager UI
```

Under the hood, this runs `npm install` in the extensions directory:
`~/.config/mail-client/extensions/`

### Extension Discovery

For v1, extensions are found by:
1. Searching npm for packages with `mail-ext-` prefix
2. Curated list in a public JSON file (GitHub)
3. Direct npm package name entry

### Extension Manager UI

```
┌─────────────────────────────────────────────────────────────────────┐
│  Settings > Extensions                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  INSTALLED                                                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ ● CRM Integration                        v1.0.0       │  │
│  │   See contact info for email senders                       │  │
│  │   [Disable] [Uninstall] [Sign In]                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  AVAILABLE                                                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ ○ LinkedIn Integration                           v0.8.0       │  │
│  │   Show LinkedIn profiles for contacts                         │  │
│  │   [Install]                                                   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ ○ Salesforce CRM                                 v2.1.0       │  │
│  │   View and edit Salesforce contacts                           │  │
│  │   [Install]                                                   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  [Install from npm package...]                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Roadmap

### Phase 1: Core Infrastructure
- [ ] Extension manifest schema and loader
- [ ] Extension lifecycle (activate/deactivate)
- [ ] Basic ExtensionContext (storage, secrets, logging)
- [ ] IPC bridge for extension ↔ main process

### Phase 2: Enrichment System
- [ ] EnrichmentProvider registration
- [ ] Enrichment cache (SQLite table)
- [ ] Hook into email viewing

### Phase 3: WebView Authentication
- [ ] Auth config parsing
- [ ] WebView window management
- [ ] Cookie capture and storage
- [ ] Page state extraction
- [ ] Session expiry detection

### Phase 4: UI Contributions
- [ ] Sidebar panel slot system
- [ ] Badge rendering in EmailList
- [ ] Extension settings UI

### Phase 5: Distribution
- [ ] CLI install/uninstall commands
- [ ] Extension manager UI in settings
- [ ] npm registry search

### Phase 6: Developer Experience
- [ ] `create-mail-extension` scaffold CLI
- [ ] Hot reload in development
- [ ] Extension debugging in DevTools
- [ ] Documentation site

---

## File Structure for Implementation

```
src/
├── main/
│   ├── extensions/
│   │   ├── extension-host.ts      # Loads and manages extensions
│   │   ├── extension-context.ts   # Creates ExtensionContext for each
│   │   ├── extension-api.ts       # Implements ExtensionAPI
│   │   ├── auth-webview.ts        # WebView auth flow
│   │   ├── enrichment-store.ts    # Enrichment cache
│   │   └── manifest-loader.ts     # Parses package.json
│   └── ipc/
│       └── extensions.ipc.ts      # IPC handlers for extension calls
│
├── renderer/
│   ├── extensions/
│   │   ├── ExtensionManager.tsx   # Settings UI for extensions
│   │   ├── ExtensionPanelSlot.tsx # Renders extension sidebar panels
│   │   ├── ExtensionBadge.tsx     # Renders extension badges
│   │   └── hooks.ts               # useExtensionPanels, etc.
│   └── components/
│       └── EmailDetail.tsx        # Modified to include extension slots
│
├── shared/
│   └── extension-types.ts         # Shared type definitions
│
└── preload/
    └── extension-api.ts           # Exposed to extensions
```
