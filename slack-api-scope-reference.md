# Slack Web API Reference -- User Token Scopes

Comprehensive reference for all API methods unlocked by the listed user token scopes.

---

## Table of Contents

1. [Search Scopes](#1-search-scopes)
2. [Conversation / Channel Scopes](#2-conversation--channel-scopes)
3. [Files Scopes](#3-files-scopes)
4. [Users Scopes](#4-users-scopes)
5. [Reactions, Stars, Pins, Bookmarks](#5-reactions-stars-pins-bookmarks)
6. [Team, Emoji, Usergroups](#6-team-emoji-usergroups)
7. [Canvases, Calls, Links](#7-canvases-calls-links)
8. [Search Query Syntax (Complete Reference)](#8-search-query-syntax-complete-reference)

---

## 1. Search Scopes

### Scope: `search:read`

The primary search scope. Unlocks all three search methods with user token.

---

### `search.all`
**URL:** `GET https://slack.com/api/search.all`
**Rate Limit:** Tier 2 (20+/min)

**What it returns:** Unified search across messages AND files in a single call. Results are grouped by content type (messages, files, posts), each with their own pagination.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | -- | Search query; supports all operators (see Section 8) |
| `count` | integer | No | 20 | Results per page (max 100) |
| `page` | integer | No | 1 | Page number (max 100) |
| `highlight` | boolean | No | false | Wrap matching terms with highlight markers |
| `sort` | string | No | `score` | `score` or `timestamp` |
| `sort_dir` | string | No | `desc` | `asc` or `desc` |
| `team_id` | string | No | -- | Required only for org-level tokens |

**Response shape:**
```json
{
  "ok": true,
  "query": "search terms",
  "messages": {
    "matches": [ /* message objects */ ],
    "pagination": { "first", "last", "page", "page_count", "per_page", "total_count" },
    "paging": { "count", "page", "pages", "total" }
  },
  "files": {
    "matches": [ /* file objects */ ],
    "pagination": { ... },
    "paging": { ... }
  }
}
```

**Pagination:** Page-based. Max page = 100. Use `search.messages` or `search.files` to paginate deeper within a content type.

---

### `search.messages`
**URL:** `GET https://slack.com/api/search.messages`
**Rate Limit:** Tier 2 (20+/min)

**What it returns:** Messages matching the query. Each match includes the message text, channel info, user, timestamp, permalink, and team.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | -- | Search query; supports all operators (see Section 8) |
| `count` | integer | No | 20 | Results per page (max 100) |
| `page` | integer | No | 1 | Page number (max 100) |
| `cursor` | string | No | -- | For cursormark pagination; use `*` for first call, then `next_cursor` |
| `highlight` | boolean | No | false | Enable highlight markers around matching terms |
| `sort` | string | No | `score` | `score` or `timestamp` |
| `sort_dir` | string | No | `desc` | `asc` or `desc` |
| `team_id` | string | No | -- | Required only for org-level tokens |

**Response shape:**
```json
{
  "ok": true,
  "query": "search terms",
  "messages": {
    "matches": [
      {
        "iid": "...",
        "channel": {
          "id": "C12345",
          "name": "general",
          "is_shared": false,
          "is_org_shared": false,
          "is_ext_shared": false
        },
        "type": "message",
        "user": "U12345",
        "username": "johndoe",
        "text": "the matching message text",
        "ts": "1512085950.000216",
        "team": "T12345",
        "permalink": "https://workspace.slack.com/archives/C12345/p1512085950000216"
      }
    ],
    "pagination": {
      "first": 1,
      "last": 20,
      "page": 1,
      "page_count": 5,
      "per_page": 20,
      "total_count": 95
    },
    "paging": {
      "count": 20,
      "page": 1,
      "pages": 5,
      "total": 95
    }
  }
}
```

**Pagination:** Supports BOTH page-based (`page`/`count`) and cursor-based (`cursor`). Max page = 100 for page-based. For cursor-based, send `cursor=*` on first call then use returned `next_cursor`.

**Highlight markers:** When `highlight=true`, matching terms are wrapped with UTF-8 private-use characters: start `\xEE\x80\x80`, end `\xEE\x80\x81`.

**Notes:**
- Results are affected by the user's Slack UI search filter settings when using user tokens.
- When multiple messages match closely (e.g., near-duplicate), only one match is returned.
- Context messages (`previous`, `previous_2`, `next`, `next_2`) were deprecated December 2020.

---

### `search.files`
**URL:** `GET https://slack.com/api/search.files`
**Rate Limit:** Tier 2 (20+/min)

**What it returns:** Files matching the query. Each match is a full file object with metadata, URLs, reactions, etc.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | -- | Search query; supports all operators (see Section 8) |
| `count` | integer | No | 20 | Results per page (max 100) |
| `page` | integer | No | 1 | Page number (max 100) |
| `highlight` | boolean | No | false | Enable highlight markers |
| `sort` | string | No | `score` | `score` or `timestamp` |
| `sort_dir` | string | No | `desc` | `asc` or `desc` |
| `team_id` | string | No | -- | Required only for org-level tokens |

**Response shape:** Same structure as `search.messages` but with `files.matches` containing file objects instead of message objects.

**Pagination:** Page-based only. Max page = 100.

---

### Granular Search Scopes

These are newer, fine-grained scopes designed for AI/agent-powered apps. They control WHAT CONTENT the search can access:

| Scope | Description | Token Types |
|-------|-------------|-------------|
| `search:read` | Search all workspace content (classic scope) | User only |
| `search:read.files` | Include files in search results | Bot, User |
| `search:read.im` | Search in direct messages | User only |
| `search:read.mpim` | Search in group direct messages | User only |
| `search:read.private` | Search in private channels | User only |
| `search:read.public` | Search in public channels | Bot, User |
| `search:read.users` | Search workspace users | Bot, User |

The granular scopes (`search:read.*`) are primarily for the newer `assistant.search.context` and `assistant.search.info` API methods (AI assistant search). The classic `search:read` scope unlocks `search.all`, `search.messages`, and `search.files`.

The granular scopes require explicit user consent through the Slack client and can be revoked at any time.

---

## 2. Conversation / Channel Scopes

### Scope: `channels:read`
Unlocks read access to **public channel** metadata.

### Scope: `groups:read`
Unlocks read access to **private channel** metadata.

### Scope: `im:read`
Unlocks read access to **direct message** channel metadata.

### Scope: `mpim:read`
Unlocks read access to **multi-person direct message** channel metadata.

All four scopes together unlock the full range of conversation metadata methods:

---

### `conversations.list`
**URL:** `GET https://slack.com/api/conversations.list`
**Rate Limit:** Tier 2 (20+/min)
**Scopes needed:** `channels:read`, `groups:read`, `im:read`, `mpim:read` (need the scope matching the type you request)

**What it returns:** All channels/conversations in the workspace, filterable by type.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | string | No | -- | Pagination cursor from `response_metadata.next_cursor` |
| `exclude_archived` | boolean | No | false | Exclude archived channels |
| `limit` | integer | No | 100 | Max items returned (max 1000; recommend <=200) |
| `team_id` | string | No | -- | Required for org-level tokens |
| `types` | string | No | `public_channel` | Comma-separated list of channel types to include |

**Available `types` values:**
- `public_channel` -- requires `channels:read`
- `private_channel` -- requires `groups:read`
- `im` -- requires `im:read`
- `mpim` -- requires `mpim:read`

Example: `types=public_channel,private_channel,im,mpim`

**Response shape:**
```json
{
  "ok": true,
  "channels": [
    {
      "id": "C12345",
      "name": "general",
      "name_normalized": "general",
      "is_channel": true,
      "is_group": false,
      "is_im": false,
      "is_mpim": false,
      "is_private": false,
      "is_archived": false,
      "created": 1449252889,
      "creator": "U12345",
      "topic": { "value": "...", "creator": "...", "last_set": 0 },
      "purpose": { "value": "...", "creator": "...", "last_set": 0 },
      "num_members": 42
    }
  ],
  "response_metadata": {
    "next_cursor": "dXNlcjpVMDYxTkZUVDI="
  }
}
```

**Pagination:** Cursor-based. Use `next_cursor` from `response_metadata`. Note: filters apply AFTER retrieval of virtual pages, so returned count may be less than `limit`.

---

### `conversations.info`
**URL:** `GET https://slack.com/api/conversations.info`
**Rate Limit:** Tier 3 (50+/min)
**Scopes needed:** `channels:read`, `groups:read`, `im:read`, or `mpim:read` (whichever matches the channel type)

**What it returns:** Detailed info about a single conversation.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel` | string | Yes | -- | Conversation ID |
| `include_locale` | boolean | No | false | Include locale info |
| `include_num_members` | boolean | No | false | Include member count |

**Response shape:**
```json
{
  "ok": true,
  "channel": {
    "id": "C12345",
    "name": "general",
    "name_normalized": "general",
    "is_channel": true,
    "is_group": false,
    "is_im": false,
    "is_mpim": false,
    "is_private": false,
    "is_archived": false,
    "created": 1449252889,
    "updated": 1619979222,
    "creator": "U12345",
    "topic": { "value": "...", "creator": "U12345", "last_set": 1612345678 },
    "purpose": { "value": "...", "creator": "U12345", "last_set": 1612345678 },
    "properties": { "tabs": [] },
    "num_members": 42,
    "locale": "en-US"
  }
}
```

For DMs, additional fields: `user`, `last_read`, `latest` (message object), `unread_count`, `priority`.

---

### `conversations.members`
**URL:** `GET https://slack.com/api/conversations.members`
**Rate Limit:** Tier 4 (100+/min)
**Scopes needed:** `channels:read`, `groups:read`, `im:read`, or `mpim:read`

**What it returns:** Paginated list of user IDs in a conversation.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel` | string | Yes | -- | Conversation ID |
| `cursor` | string | No | -- | Pagination cursor |
| `limit` | integer | No | 100 | Max items (recommend <=200) |

**Response shape:**
```json
{
  "ok": true,
  "members": ["U12345", "U67890", "U11111"],
  "response_metadata": { "next_cursor": "..." }
}
```

**Pagination:** Cursor-based.

---

### Scope: `channels:history`
Unlocks message history in **public channels**.

### Scope: `groups:history`
Unlocks message history in **private channels**.

### Scope: `im:history`
Unlocks message history in **direct messages**.

### Scope: `mpim:history`
Unlocks message history in **multi-person direct messages**.

---

### `conversations.history`
**URL:** `GET https://slack.com/api/conversations.history`
**Rate Limit:** Tier 3 (50+/min)
**Scopes needed:** `channels:history`, `groups:history`, `im:history`, or `mpim:history` (whichever matches)

**What it returns:** Messages and events from a conversation, ordered newest-first.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel` | string | Yes | -- | Conversation ID |
| `cursor` | string | No | -- | Pagination cursor |
| `inclusive` | boolean | No | false | Include messages at `oldest`/`latest` boundary timestamps |
| `latest` | string | No | now | Only messages BEFORE this Unix timestamp |
| `oldest` | string | No | 0 | Only messages AFTER this Unix timestamp |
| `limit` | integer | No | 100 | Max messages to return (max 999) |
| `include_all_metadata` | boolean | No | false | Return all message metadata |

**Retrieve a single message:** Set `oldest` to the message ts, `inclusive=true`, `limit=1`.

**Response shape:**
```json
{
  "ok": true,
  "messages": [
    {
      "type": "message",
      "user": "U12345",
      "text": "Hello world",
      "ts": "1512085950.000216",
      "team": "T12345",
      "reactions": [{ "name": "thumbsup", "users": ["U12345"], "count": 1 }],
      "attachments": [],
      "blocks": [],
      "files": [],
      "thread_ts": "1512085950.000216",
      "reply_count": 3,
      "reply_users_count": 2,
      "latest_reply": "1512086000.000300"
    }
  ],
  "has_more": true,
  "pin_count": 2,
  "response_metadata": { "next_cursor": "bmV4dF90czox..." }
}
```

**Pagination:** Cursor-based. Also supports time-range windowing with `oldest`/`latest`.

---

### `conversations.replies`
**URL:** `GET https://slack.com/api/conversations.replies`
**Rate Limit:** Tier 3 (50+/min)
**Scopes needed:** `channels:history`, `groups:history`, `im:history`, or `mpim:history`

**What it returns:** All messages in a thread, starting with the parent message.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel` | string | Yes | -- | Conversation ID |
| `ts` | string | Yes | -- | Timestamp of parent message (or any message in thread) |
| `cursor` | string | No | -- | Pagination cursor |
| `inclusive` | boolean | No | false | Include boundary timestamps |
| `latest` | string | No | now | Only messages before this timestamp |
| `oldest` | string | No | 0 | Only messages after this timestamp |
| `limit` | integer | No | 1000 | Max items (recommend <=200) |
| `include_all_metadata` | boolean | No | false | Return all metadata |

**Response shape:**
```json
{
  "ok": true,
  "messages": [
    {
      "type": "message",
      "user": "U12345",
      "text": "Parent message",
      "thread_ts": "1512085950.000216",
      "reply_count": 3,
      "subscribed": true,
      "last_read": "1512086000.000300",
      "unread_count": 0,
      "ts": "1512085950.000216"
    },
    {
      "type": "message",
      "user": "U67890",
      "text": "Reply message",
      "thread_ts": "1512085950.000216",
      "parent_user_id": "U12345",
      "ts": "1512086000.000300"
    }
  ],
  "has_more": false,
  "response_metadata": { "next_cursor": "" }
}
```

**Pagination:** Cursor-based with optional time-range filtering.

---

## 3. Files Scopes

### Scope: `files:read`

Unlocks: `files.list`, `files.info`

---

### `files.list`
**URL:** `GET https://slack.com/api/files.list`
**Rate Limit:** Tier 3 (50+/min)

**What it returns:** Files uploaded to the workspace, with optional filtering.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel` | string | No | -- | Filter by channel ID |
| `user` | string | No | -- | Filter by user ID |
| `ts_from` | string | No | 0 | Files created after this Unix timestamp (inclusive) |
| `ts_to` | string | No | now | Files created before this Unix timestamp (inclusive) |
| `types` | string | No | `all` | Comma-separated file type filter |
| `count` | integer | No | 100 | Results per page |
| `page` | integer | No | 1 | Page number |
| `show_files_hidden_by_limit` | boolean | No | false | Include files hidden by free workspace limits |
| `team_id` | string | No | -- | Required for org-level tokens |

**Available `types` values:**
- `all` -- all file types
- `spaces` -- posts (Slack posts/documents)
- `snippets` -- code snippets
- `images` -- image files
- `gdocs` -- Google Docs integrations
- `zips` -- zip/archive files
- `pdfs` -- PDF documents

Example: `types=images,pdfs`

**Response shape:**
```json
{
  "ok": true,
  "files": [
    {
      "id": "F12345",
      "created": 1507850315,
      "timestamp": 1507850315,
      "name": "document.pdf",
      "title": "My Document",
      "mimetype": "application/pdf",
      "filetype": "pdf",
      "pretty_type": "PDF",
      "user": "U12345",
      "size": 123456,
      "mode": "hosted",
      "url_private": "https://files.slack.com/files-pri/T12345-F12345/document.pdf",
      "url_private_download": "https://files.slack.com/files-pri/T12345-F12345/download/document.pdf",
      "permalink": "https://workspace.slack.com/files/U12345/F12345/document.pdf",
      "permalink_public": "https://slack-files.com/...",
      "thumb_64": "https://files.slack.com/.../document_64.png",
      "thumb_80": "https://files.slack.com/.../document_80.png",
      "thumb_160": "https://files.slack.com/.../document_160.png",
      "thumb_360": "https://files.slack.com/.../document_360.png",
      "channels": ["C12345"],
      "groups": [],
      "ims": [],
      "comments_count": 0
    }
  ],
  "paging": {
    "count": 100,
    "total": 42,
    "page": 1,
    "pages": 1
  }
}
```

**Pagination:** Page-based using `count` and `page`.

---

### `files.info`
**URL:** `GET https://slack.com/api/files.info`
**Rate Limit:** Tier 4 (100+/min)

**What it returns:** Complete metadata for a single file, including comments.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | -- | File ID (e.g., `F2147483862`) |
| `count` | integer | No | 100 | Number of comments to return |
| `cursor` | string | No | -- | Pagination cursor for comments |
| `limit` | integer | No | -- | Max items to return |
| `page` | integer | No | 1 | Comment page number |

**Response shape:**
```json
{
  "ok": true,
  "file": {
    "id": "F12345",
    "created": 1507850315,
    "timestamp": 1507850315,
    "name": "report.pdf",
    "title": "Q4 Report",
    "mimetype": "application/pdf",
    "filetype": "pdf",
    "pretty_type": "PDF",
    "user": "U12345",
    "size": 523456,
    "mode": "hosted",
    "editable": false,
    "is_external": false,
    "is_public": true,
    "is_starred": false,
    "public_url_shared": false,
    "url_private": "https://files.slack.com/files-pri/T12345-F12345/report.pdf",
    "url_private_download": "https://files.slack.com/files-pri/T12345-F12345/download/report.pdf",
    "permalink": "https://workspace.slack.com/files/U12345/F12345/report.pdf",
    "permalink_public": "https://slack-files.com/...",
    "thumb_64": "...",
    "thumb_80": "...",
    "thumb_160": "...",
    "thumb_360": "...",
    "thumb_480": "...",
    "thumb_720": "...",
    "thumb_960": "...",
    "thumb_1024": "...",
    "original_w": 1024,
    "original_h": 768,
    "channels": ["C12345"],
    "groups": ["G12345"],
    "ims": ["D12345"],
    "has_rich_preview": true,
    "alt_txt": "Description of file",
    "shares": {
      "public": { "C12345": [{ "ts": "...", "reply_users": [], "reply_count": 0 }] },
      "private": { "G12345": [{ "ts": "..." }] }
    },
    "reactions": [{ "name": "thumbsup", "users": ["U12345"], "count": 1 }],
    "comments_count": 2
  },
  "comments": [
    { "id": "Fc12345", "comment": "Nice report!", "user": "U67890", "created": 1507850400 }
  ],
  "response_metadata": { "next_cursor": "..." }
}
```

**How to download files:**
- Use the `url_private_download` URL from the response
- Include the user/bot token in the `Authorization: Bearer xoxp-...` header
- The `url_private` field serves the file in-browser; `url_private_download` triggers a download

**Pagination:** Cursor-based for comments; max 1000 results per request.

---

### Scope: `remote_files:read`

Unlocks: `files.remote.list`, `files.remote.info`

---

### `files.remote.list`
**URL:** `GET https://slack.com/api/files.remote.list`
**Rate Limit:** Tier 2 (20+/min)

**What it returns:** Remote files (files hosted externally but surfaced in Slack).

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel` | string | No | -- | Filter by channel ID |
| `cursor` | string | No | -- | Pagination cursor |
| `limit` | integer | No | -- | Max items to return |
| `ts_from` | string | No | 0 | Files created after this timestamp |
| `ts_to` | string | No | now | Files created before this timestamp |

**Response shape:**
```json
{
  "ok": true,
  "files": [ /* remote file objects */ ],
  "response_metadata": { "next_cursor": "" }
}
```

**Pagination:** Cursor-based.

---

### `files.remote.info`
**URL:** `GET https://slack.com/api/files.remote.info`
**Rate Limit:** Tier 2 (20+/min)

**What it returns:** Info about a single remote file.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `external_id` | string | No | -- | Creator-defined GUID (use this OR `file`, not both) |
| `file` | string | No | -- | File ID from Slack |

**Response includes:** file ID, creation timestamp, name, MIME type, user/team info, `external_id`, `external_url`, `external_type`, `url_private`, `permalink`, sharing status, `is_starred`, `is_public`, `editable`, `has_rich_preview`, comment count, access level.

---

## 4. Users Scopes

### Scope: `users:read`

Unlocks: `users.list`, `users.info`, `users.getPresence`

---

### `users.list`
**URL:** `GET https://slack.com/api/users.list`
**Rate Limit:** Tier 2 (20+/min)

**What it returns:** All users in the workspace (active and deactivated).

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | string | No | -- | Pagination cursor |
| `limit` | integer | No | -- | Max items (up to 1000; recommend <=200) |
| `include_locale` | boolean | No | false | Include user locale info |
| `team_id` | string | No | -- | Required for org-level tokens |

**Response shape:**
```json
{
  "ok": true,
  "members": [
    {
      "id": "U12345",
      "team_id": "T12345",
      "name": "johndoe",
      "deleted": false,
      "color": "4bbe2e",
      "real_name": "John Doe",
      "tz": "America/New_York",
      "tz_label": "Eastern Standard Time",
      "tz_offset": -18000,
      "profile": {
        "first_name": "John",
        "last_name": "Doe",
        "real_name": "John Doe",
        "display_name": "johndoe",
        "email": "john@example.com",
        "status_text": "Working remotely",
        "status_emoji": ":house:",
        "image_24": "https://...",
        "image_32": "https://...",
        "image_48": "https://...",
        "image_72": "https://...",
        "image_192": "https://...",
        "image_512": "https://..."
      },
      "is_admin": false,
      "is_owner": false,
      "is_primary_owner": false,
      "is_bot": false,
      "is_app_user": false,
      "is_restricted": false,
      "is_ultra_restricted": false,
      "has_2fa": true,
      "updated": 1619979222
    }
  ],
  "cache_ts": 1619979222,
  "response_metadata": { "next_cursor": "..." }
}
```

**Pagination:** Cursor-based. Use `next_cursor`.

**Note:** Email field requires additional `users:read.email` scope (not in your token list). Presence info via this method is deprecated; use `users.getPresence` instead.

---

### `users.info`
**URL:** `GET https://slack.com/api/users.info`
**Rate Limit:** Tier 4 (100+/min)

**What it returns:** Complete info for a single user.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `user` | string | Yes | -- | User ID |
| `include_locale` | boolean | No | false | Include locale info |

**Response shape:** Same user object structure as `users.list` but for a single user wrapped in `{ "ok": true, "user": { ... } }`.

---

### `users.getPresence`
**URL:** `GET https://slack.com/api/users.getPresence`
**Rate Limit:** Tier 3 (50+/min)

**What it returns:** User's presence status.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `user` | string | No | authed user | User ID to query |

**Response shape:**

For other users:
```json
{ "ok": true, "presence": "active" }
```
Values: `active` or `away`

For the authenticated user (self):
```json
{
  "ok": true,
  "presence": "active",
  "online": true,
  "auto_away": false,
  "manual_away": false,
  "connection_count": 1,
  "last_activity": 1619979222
}
```

---

### Scope: `users.profile:read`

Unlocks: `users.profile.get`

---

### `users.profile.get`
**URL:** `GET https://slack.com/api/users.profile.get`
**Rate Limit:** Tier 4 (100+/min)

**What it returns:** A user's full profile including custom status and custom fields.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `user` | string | No | authed user | User ID to query |
| `include_labels` | boolean | No | false | Include labels for custom profile fields (CAUTION: heavily rate-limited) |

**Response shape:**
```json
{
  "ok": true,
  "profile": {
    "avatar_hash": "abc123",
    "display_name": "johndoe",
    "display_name_normalized": "johndoe",
    "email": "john@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "real_name": "John Doe",
    "real_name_normalized": "John Doe",
    "phone": "+1234567890",
    "pronouns": "he/him",
    "skype": "john.doe",
    "title": "Senior Engineer",
    "status_text": "In a meeting",
    "status_emoji": ":calendar:",
    "status_expiration": 1619990000,
    "image_24": "https://...",
    "image_32": "https://...",
    "image_48": "https://...",
    "image_72": "https://...",
    "image_192": "https://...",
    "image_512": "https://...",
    "start_date": "2020-01-15",
    "team": "T12345",
    "huddle_state": "...",
    "fields": {
      "Xf12345": { "value": "Product", "alt": "" },
      "Xf67890": { "value": "San Francisco", "alt": "" }
    }
  }
}
```

**Note:** Custom field definitions (labels, options) come from `team.profile.get` (requires `users.profile:read` scope). The `fields` object here contains values keyed by field ID.

---

## 5. Reactions, Stars, Pins, Bookmarks

### Scope: `reactions:read`

Unlocks: `reactions.list`, `reactions.get`

---

### `reactions.list`
**URL:** `GET https://slack.com/api/reactions.list`
**Rate Limit:** Tier 2 (20+/min)

**What it returns:** All items (messages, files, file comments) that a user has reacted to.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `user` | string | No | authed user | Show reactions from this user |
| `full` | boolean | No | false | Return complete reaction list |
| `count` | integer | No | 100 | Results per page |
| `page` | integer | No | 1 | Page number |
| `cursor` | string | No | -- | Pagination cursor |
| `limit` | integer | No | -- | Max items |
| `team_id` | string | No | -- | Required for org-level tokens |

**Response shape:**
```json
{
  "ok": true,
  "items": [
    {
      "type": "message",
      "channel": "C12345",
      "message": {
        "type": "message",
        "text": "Hello!",
        "user": "U12345",
        "ts": "1512085950.000216",
        "reactions": [
          { "name": "thumbsup", "users": ["U67890"], "count": 1 },
          { "name": "heart", "users": ["U67890", "U11111"], "count": 2 }
        ]
      }
    },
    {
      "type": "file",
      "file": { /* file object */ }
    }
  ],
  "response_metadata": { "next_cursor": "..." },
  "paging": { "per_page": 100, "spill": 0, "page": 1, "total": 42, "pages": 1 }
}
```

**Item types:** `message`, `file`, `file_comment`

**Pagination:** Supports both cursor-based and page-based. Recommend <= 200 results per request.

**Notes:**
- The `users` array in reactions may not include ALL reactors, but `count` always reflects the true total.
- Multiple reactions on one message can result in duplicate items in the results.

---

### `reactions.get`
**URL:** `GET https://slack.com/api/reactions.get`
**Rate Limit:** Tier 3 (50+/min)

**What it returns:** All reactions on a single item (message, file, or file comment).

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel` | string | Conditional | -- | Channel ID (required with `timestamp` for messages) |
| `timestamp` | string | Conditional | -- | Message timestamp (required with `channel`) |
| `file` | string | Conditional | -- | File ID (for file reactions) |
| `file_comment` | string | Conditional | -- | File comment ID |
| `full` | boolean | No | false | Return complete reaction list |

Must provide ONE of: `channel`+`timestamp`, `file`, or `file_comment`.

**Response shape:**
```json
{
  "ok": true,
  "type": "message",
  "message": {
    "text": "Hello!",
    "reactions": [
      { "name": "thumbsup", "users": ["U12345", "U67890"], "count": 2 },
      { "name": "heart", "users": ["U12345"], "count": 1 }
    ]
  }
}
```

---

### Scope: `stars:read`

Unlocks: `stars.list`

**DEPRECATION WARNING:** Stars have been replaced by "Saved items" in Slack. `stars.list` still works but no longer reflects newly saved items. Stars can no longer be viewed or interacted with by end-users in the UI.

---

### `stars.list`
**URL:** `GET https://slack.com/api/stars.list`
**Rate Limit:** Tier 3 (50+/min)

**What it returns:** The authenticated user's starred (saved) items.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `count` | integer | No | 100 | Results per page |
| `cursor` | string | No | -- | Pagination cursor |
| `limit` | integer | No | -- | Max items |
| `page` | integer | No | 1 | Page number |
| `team_id` | string | No | -- | Required for org-level tokens |

**Response shape:**
```json
{
  "ok": true,
  "items": [
    { "type": "message", "channel": "C12345", "message": { /* message object */ } },
    { "type": "file", "file": { /* file object */ } },
    { "type": "file_comment", "file": { ... }, "comment": { ... } },
    { "type": "channel", "channel": "C12345" },
    { "type": "im", "channel": "D12345" },
    { "type": "group", "channel": "G12345" }
  ],
  "paging": { "per_page": 100, "spill": 0, "page": 1, "total": 10, "pages": 1 }
}
```

**Item types:** `message`, `file`, `file_comment`, `channel`, `im`, `group`

**Pagination:** Cursor-based and page-based. Recommend <= 200 results per request.

---

### `pins.list`

**Note:** `pins:read` is NOT in your scope list. This method requires `pins:read` scope. However, pinned messages can be discovered through `conversations.history` (pinned messages have metadata) and through the search operator `has:pin`.

**URL:** `GET https://slack.com/api/pins.list`
**Rate Limit:** Tier 2 (20+/min)
**Scope required:** `pins:read`

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel` | string | Yes | -- | Channel ID |

**Response shape:**
```json
{
  "ok": true,
  "items": [
    {
      "type": "message",
      "channel": "C12345",
      "message": { "text": "...", "ts": "...", "user": "...", "permalink": "..." },
      "created": 1507850315,
      "created_by": "U12345"
    }
  ]
}
```

---

### `bookmarks.list`

**Note:** `bookmarks:read` is NOT in your scope list. This method requires `bookmarks:read` scope.

**URL:** `POST https://slack.com/api/bookmarks.list`
**Rate Limit:** Tier 3 (50+/min)
**Scope required:** `bookmarks:read`

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel_id` | string | Yes | -- | Channel ID |

**Response shape:**
```json
{
  "ok": true,
  "bookmarks": [
    {
      "id": "Bk12345",
      "channel_id": "C12345",
      "title": "Design Spec",
      "link": "https://example.com/spec",
      "emoji": ":art:",
      "icon_url": "https://...",
      "type": "link",
      "entity_id": "...",
      "date_created": 1619979222,
      "date_updated": 1619979222,
      "rank": "U",
      "last_updated_by_user_id": "U12345",
      "last_updated_by_team_id": "T12345",
      "shortcut_id": "...",
      "app_id": "..."
    }
  ]
}
```

Max 100 bookmarks per channel.

---

## 6. Team, Emoji, Usergroups

### Scope: `team:read`

Unlocks: `team.info`

---

### `team.info`
**URL:** `GET https://slack.com/api/team.info`
**Rate Limit:** Tier 3 (50+/min)

**What it returns:** Workspace/team metadata.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `team` | string | No | authed team | Workspace ID (omit to get info for the requesting team) |
| `domain` | string | No | -- | Query by domain (enterprise contexts only) |

**Response shape:**
```json
{
  "ok": true,
  "team": {
    "id": "T12345",
    "name": "My Workspace",
    "domain": "myworkspace",
    "email_domain": "example.com",
    "icon": {
      "image_34": "https://...",
      "image_44": "https://...",
      "image_68": "https://...",
      "image_88": "https://...",
      "image_102": "https://...",
      "image_132": "https://...",
      "image_default": false
    },
    "enterprise_id": "E1234A12AB",
    "enterprise_name": "Umbrella Corporation"
  }
}
```

---

### Scope: `emoji:read`

Unlocks: `emoji.list`

---

### `emoji.list`
**URL:** `GET https://slack.com/api/emoji.list`
**Rate Limit:** Tier 2 (20+/min)

**What it returns:** All custom emoji for the workspace.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `include_categories` | boolean | No | false | Include Unicode emoji categories and their contents |

**Response shape:**
```json
{
  "ok": true,
  "emoji": {
    "bowtie": "https://my.slack.com/emoji/bowtie/46ec6f2bb0.png",
    "squirrel": "https://my.slack.com/emoji/squirrel/f35f40c0e0.png",
    "shipit": "alias:squirrel",
    "custom_emoji": "https://my.slack.com/emoji/custom/abc123.png"
  }
}
```

Custom emoji are name-to-URL pairs. Aliases use the `alias:original_name` format.

---

### Scope: `usergroups:read`

Unlocks: `usergroups.list`, `usergroups.users.list`

---

### `usergroups.list`
**URL:** `GET https://slack.com/api/usergroups.list`
**Rate Limit:** Tier 2 (20+/min)

**What it returns:** All User Groups (handle groups like @engineering, @design) in the workspace.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `include_count` | boolean | No | false | Include user count for each group |
| `include_disabled` | boolean | No | false | Include disabled User Groups |
| `include_users` | boolean | No | false | Include user ID list for each group |
| `team_id` | string | No | -- | Required for org-level tokens |

**Response shape:**
```json
{
  "ok": true,
  "usergroups": [
    {
      "id": "S0604QSJC",
      "team_id": "T12345",
      "is_usergroup": true,
      "name": "Engineering",
      "description": "Engineering team",
      "handle": "engineering",
      "is_external": false,
      "date_create": 1446598059,
      "date_update": 1619979222,
      "date_delete": 0,
      "auto_type": null,
      "created_by": "U12345",
      "updated_by": "U12345",
      "deleted_by": null,
      "prefs": {
        "channels": ["C12345"],
        "groups": ["G12345"]
      },
      "user_count": "15",
      "users": ["U12345", "U67890"]
    }
  ]
}
```

---

### `usergroups.users.list`
**URL:** `GET https://slack.com/api/usergroups.users.list`
**Rate Limit:** Tier 2 (20+/min)

**What it returns:** All user IDs in a specific User Group.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `usergroup` | string | Yes | -- | User Group ID (e.g., `S0604QSJC`) |
| `include_disabled` | boolean | No | false | Include disabled User Groups |
| `team_id` | string | No | -- | Required for org-level tokens |

**Response shape:**
```json
{
  "ok": true,
  "users": ["U060R4BJ4", "W123A4BC5"]
}
```

---

## 7. Canvases, Calls, Links

### Scope: `canvases:read`

Unlocks: `canvases.sections.lookup`

---

### `canvases.sections.lookup`
**URL:** `POST https://slack.com/api/canvases.sections.lookup`
**Rate Limit:** Tier 3 (50+/min)

**What it returns:** Sections within a canvas matching specified criteria.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `canvas_id` | string | Yes | -- | Encoded canvas ID (e.g., `F1234ABCD`) |
| `criteria` | object | Yes | -- | Filtering specification (see below) |

**Criteria object:**
```json
{
  "section_types": ["h1", "h2", "h3", "any_header"],
  "contains_text": "Grocery List"
}
```

- `section_types`: Array of heading types -- `h1`, `h2`, `h3`, `any_header`
- `contains_text`: Text string to search within sections

Both parameters can be combined.

**Response shape:**
```json
{
  "ok": true,
  "sections": [
    { "id": "temp:C:eBa219af721c664422cb90a52fac" }
  ]
}
```

**Note:** Section IDs returned here can be used with `canvases.edit` (requires `canvases:write`) to edit sections or apply edits relative to a section. With `canvases:read` alone, you can only look up/find sections, not modify them.

---

### Scope: `calls:read`

Unlocks: `calls.info`

---

### `calls.info`
**URL:** `POST https://slack.com/api/calls.info`
**Rate Limit:** Tier 3 (50+/min)

**What it returns:** Information about a Slack Call (huddle/call integration).

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `id` | string | Yes | -- | Call identifier (returned by `calls.add`) |

**Response shape:**
```json
{
  "ok": true,
  "call": {
    "id": "R0E69JAIF",
    "date_start": 1562002086,
    "external_unique_id": "025169F6-E37A-4E62-BB54-7F93A0FC4C1F",
    "join_url": "https://callmebeepme.com/calls/1234567890",
    "desktop_app_join_url": "callapp://join/1234567890",
    "external_display_id": "705-292-868",
    "title": "Team sync up",
    "users": [
      { "slack_id": "U0MQG83FD" },
      {
        "external_id": "54321678",
        "display_name": "Jane Doe",
        "avatar_url": "https://example.com/avatar.jpg"
      }
    ]
  }
}
```

---

### Scope: `links:read`

This scope does NOT unlock any REST API methods directly. It enables receiving the `link_shared` event, which fires when URLs are posted in conversations. This is used for link unfurling -- your app can respond to shared links by providing rich preview content.

**What it grants:** Read-only access to URLs in messages via the `link_shared` event.

---

## 8. Search Query Syntax (Complete Reference)

This applies to `search.all`, `search.messages`, and `search.files`. The query string supports the following operators and syntax:

### Basic Text Search

| Syntax | Description | Example |
|--------|-------------|---------|
| `word` | Simple keyword match | `budget` |
| `"exact phrase"` | Exact phrase match (preserves word order) | `"Q4 budget report"` |
| `word*` | Wildcard/prefix match (min 3 chars before `*`) | `rep*` matches "report", "reply", "repository" |

### Boolean / Exclusion Operators

| Syntax | Description | Example |
|--------|-------------|---------|
| `word1 word2` | Implicit AND -- both terms must appear | `budget report` |
| `-word` | Exclude results containing this word | `budget -draft` |
| `-modifier:value` | Exclude results matching a modifier | `-in:#random`, `-from:@bob` |

**Note:** Slack search does NOT support explicit `AND`, `OR`, or `NOT` keywords. Multiple terms are always AND-ed together. Use `-` for exclusion.

### Location Modifiers

| Modifier | Description | Example |
|----------|-------------|---------|
| `in:#channel-name` | Search within a specific public/private channel | `in:#engineering` |
| `in:channel-name` | The `#` is optional | `in:engineering` |
| `in:<@UserID>` | Search within a DM with a specific user | `in:<@U12345>` |
| `with:@display-name` | Search threads and DMs with a specific person | `with:@sara` |

### People Modifiers

| Modifier | Description | Example |
|----------|-------------|---------|
| `from:@display-name` | Messages sent by a specific person | `from:@sara` |
| `from:<@UserID>` | Messages from a user by ID | `from:<@U12345>` |
| `from:botname` | Messages from a specific bot | `from:slackbot` |
| `creator:@display-name` | Canvases created by a specific person | `creator:@sara` |

### Content/Attribute Modifiers

| Modifier | Description | Example |
|----------|-------------|---------|
| `has::emoji-code:` | Messages with a specific emoji reaction (by anyone) | `has::eyes:` |
| `hasmy::emoji-code:` | Messages YOU have reacted to with specific emoji | `hasmy::thumbsup:` |
| `has:pin` | Messages/content that has been pinned | `has:pin` |
| `has:link` | Messages containing a URL/link | `has:link` |
| `has:star` | Messages that have been starred/saved | `has:star` |
| `is:saved` | Your saved items | `is:saved` |
| `is:thread` | Messages that are part of a thread | `is:thread` |

### Date Modifiers

| Modifier | Description | Example |
|----------|-------------|---------|
| `before:YYYY-MM-DD` | Results before a specific date | `before:2024-01-15` |
| `after:YYYY-MM-DD` | Results after a specific date | `after:2024-01-01` |
| `on:YYYY-MM-DD` | Results on a specific date | `on:2024-03-15` |
| `during:month` | Results during a specific month (current year) | `during:january` |
| `during:month YYYY` | Results during a specific month and year | `during:march 2024` |
| `during:YYYY` | Results during a specific year | `during:2024` |

Date formats accepted: `YYYY-MM-DD`, month names, relative terms (today, yesterday, this week).

### Combining Modifiers

All modifiers can be combined freely:

```
budget report in:#finance from:@sara after:2024-01-01 has:link
```

This finds messages containing "budget" AND "report", in #finance, from Sara, after Jan 1 2024, that contain a link.

```
"quarterly review" in:#leadership -from:@bot during:2024 has::thumbsup:
```

This finds the exact phrase "quarterly review" in #leadership, not from @bot, during 2024, that has a thumbsup reaction.

### Search Tips for the API

1. **Results are scoped to the authenticated user's access.** The user token can only search conversations the user is a member of (or public channels they can see).
2. **UI filters affect results.** If the user has set search filters in the Slack UI, those persist and affect API search results too.
3. **Max depth:** Page-based pagination maxes out at page 100 with up to 100 results per page = **10,000 results maximum** per search query.
4. **Sort by timestamp** (`sort=timestamp&sort_dir=asc`) is useful for chronological traversal.
5. **Highlight markers** (when `highlight=true`) use UTF-8 private-use characters: start `\xEE\x80\x80` (U+E000), end `\xEE\x80\x81` (U+E001).

---

## Quick Reference: Scope-to-Method Matrix

| Scope | Methods Unlocked |
|-------|-----------------|
| `calls:read` | `calls.info` |
| `canvases:read` | `canvases.sections.lookup` |
| `channels:history` | `conversations.history`, `conversations.replies` (public channels) |
| `channels:read` | `conversations.list`, `conversations.info`, `conversations.members` (public channels) |
| `emoji:read` | `emoji.list` |
| `files:read` | `files.list`, `files.info` |
| `groups:history` | `conversations.history`, `conversations.replies` (private channels) |
| `groups:read` | `conversations.list`, `conversations.info`, `conversations.members` (private channels) |
| `im:history` | `conversations.history`, `conversations.replies` (DMs) |
| `im:read` | `conversations.list`, `conversations.info`, `conversations.members` (DMs) |
| `links:read` | Event: `link_shared` (no REST methods) |
| `mpim:history` | `conversations.history`, `conversations.replies` (group DMs) |
| `mpim:read` | `conversations.list`, `conversations.info`, `conversations.members` (group DMs) |
| `reactions:read` | `reactions.list`, `reactions.get` |
| `remote_files:read` | `files.remote.list`, `files.remote.info` |
| `search:read` | `search.all`, `search.messages`, `search.files` |
| `search:read.files` | Files in AI/agent search (Real-time Search API) |
| `search:read.im` | DM content in AI/agent search |
| `search:read.mpim` | Group DM content in AI/agent search |
| `search:read.private` | Private channel content in AI/agent search |
| `search:read.public` | Public channel content in AI/agent search; `assistant.search.context`, `assistant.search.info` |
| `search:read.users` | User search in AI/agent search |
| `stars:read` | `stars.list` (DEPRECATED -- no longer reflects new saves) |
| `team:read` | `team.info` |
| `usergroups:read` | `usergroups.list`, `usergroups.users.list` |
| `users.profile:read` | `users.profile.get` |
| `users:read` | `users.list`, `users.info`, `users.getPresence` |

---

## Pagination Patterns Summary

| Pattern | Methods Using It | How It Works |
|---------|-----------------|--------------|
| **Cursor-based** | `conversations.list`, `conversations.history`, `conversations.replies`, `conversations.members`, `users.list`, `reactions.list`, `files.remote.list` | Send `cursor` param; get `response_metadata.next_cursor` back. Empty string = no more pages. |
| **Page-based** | `search.messages`, `search.files`, `search.all`, `files.list`, `stars.list` | Send `page` (1-100) and `count` (max 100). Response includes `paging.pages` for total. |
| **Both** | `reactions.list`, `stars.list` | Support both cursor and page params. Cursor preferred. |
| **Cursormark** | `search.messages` | Hybrid: send `cursor=*` first, then use returned `next_cursor`. Allows deeper pagination than page-based. |

---

## Rate Limit Tiers

| Tier | Rate | Methods |
|------|------|---------|
| Tier 1 | 1+/min | (none in your scopes) |
| Tier 2 | 20+/min | `search.*`, `conversations.list`, `reactions.list`, `emoji.list`, `usergroups.*`, `files.remote.*`, `pins.list`, `bookmarks.list` |
| Tier 3 | 50+/min | `conversations.history`, `conversations.replies`, `conversations.info`, `team.info`, `users.getPresence`, `stars.list`, `calls.info`, `canvases.sections.lookup` |
| Tier 4 | 100+/min | `files.info`, `users.info`, `users.profile.get`, `conversations.members` |
