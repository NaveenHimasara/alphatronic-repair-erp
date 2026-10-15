# Architecture

## Overview

The whole backend is one file, [`server.js`](../server.js), and has **no npm dependencies**. It uses only Node.js built-ins:

| Module | Used for |
|---|---|
| `http` | Static file server and JSON REST endpoints |
| `crypto` | `scrypt` PIN hashing, session tokens, WebSocket handshake |
| `node:sqlite` | Embedded SQLite database (`DatabaseSync`) |
| `fs`, `path`, `os` | Files, backups, LAN address discovery |

The frontend, [`public/index.html`](../public/index.html), is a single-page app styled with a bundled copy of Tailwind CSS and Font Awesome, so it works with no internet connection.

## Request flow

```
Browser ──HTTP──► /api/login ──► scrypt verify ──► session token
   │
   └──WebSocket /ws?token=… ──► { type:"action", action:"createOrder", payload } 
                                     │
                                     ├─ re-validate session
                                     ├─ check role is allowed for this action
                                     ├─ validate + write to SQLite (transaction)
                                     ├─ append to activity_log
                                     └─ broadcast a role-filtered snapshot to ALL clients
```

## Database schema

SQLite in WAL mode with `foreign_keys = ON` and `synchronous = FULL`.

| Table | Purpose |
|---|---|
| `users` | One row per role: `pin_hash`, `pin_salt` |
| `sessions` | Login tokens per device |
| `orders` | Repair jobs: customer, product, fees, status, outcome, timestamps |
| `order_parts` | Components used per order (`ON DELETE CASCADE`) |
| `activity_log` | Append-only audit trail of every action |

## WebSocket actions

| Action | Allowed roles | Description |
|---|---|---|
| `createOrder` | intake, ceo | Create a new job |
| `updateTechLog` | tech, ceo | Update progress, parts, outcome |
| `confirmBilling` | ceo | Price parts and confirm the bill |
| `deleteOrder` | ceo | Delete a job (the full record is kept in the log) |
| `resetPin` | ceo | Clear the Front Desk or Technician PIN and log that role out |
| `changeOwnPin` | all | Change your own PIN |
| `activityLog` | ceo | Read the last 200 log entries |

Server → client messages: `hello`, `snapshot`, `presence`, `result`, `logout`, `pong`.

The WebSocket implementation (RFC 6455) supports text frames, fragmentation, ping/pong heartbeats every 20 s, and a 2 MB message limit.

## HTTP endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/status` | none | Roles (and whether each has a PIN) and server addresses |
| POST | `/api/login` | none | `{ role, pin, device }` → `{ token }` |
| POST | `/api/logout` | token | End the session |
| GET | `/api/session` | token | Current session info |
| GET | `/api/backup` | Manager | Download a consistent `.db` snapshot |
| GET | `/api/export.json` | Manager | Export all orders as JSON |
| POST | `/api/import` | Manager | Import orders from JSON (an automatic backup is taken first) |

## Security model

- **PINs** are hashed with `scrypt` and a random 16-byte salt, and compared with `crypto.timingSafeEqual`.
- **Brute-force protection:** 5 failed logins from one IP lock it out for 60 seconds.
- **Sessions** use 256-bit random tokens, stored server-side and re-checked on every action.
- **Authorization** is enforced on the server for every action. The client UI is never trusted.
- **Data minimization:** the Technician role never receives fee or price fields.
- **Path traversal:** static file paths are normalized and confined to `public/`.
- **Input validation:** lengths, numeric ranges and dates are checked on the server.

### Known limitations

- Traffic is plain HTTP. The system is meant for a trusted LAN only and must not be exposed to the internet.
- PINs are 4–8 digits, which is convenient for a shop counter but not strong enough for hostile networks.

## Backups

- On start-up and every hour, the server makes sure today's snapshot exists, using `VACUUM INTO`. This gives one consistent backup per day, and the last 30 are kept.
- A `before_import` snapshot is always taken before an import.
