<div align="center">

# ⚡ Alphatronic Repair ERP

**A lightweight, offline-first job-tracking system for electronics repair shops.**
One laptop runs the server, every other device just opens a browser, and every change appears everywhere instantly.

[![CI](https://github.com/nhimasara2001-ai/alphatronic-repair-erp/actions/workflows/ci.yml/badge.svg)](https://github.com/nhimasara2001-ai/alphatronic-repair-erp/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.13-339933?logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/npm%20dependencies-0-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)

[Features](#-features) •
[Quick start](#-quick-start) •
[Documentation](#-documentation) •
[Architecture](#-architecture) •
[Security](#-security) •
[Contributing](#-contributing)

</div>

---

## 📖 About

Alphatronic Repair ERP tracks every repair job from the moment a customer hands over a device until the Manager approves the final bill. It was built for a real repair shop where three people (Front Desk, Technician and Manager) work on separate laptops over the shop Wi-Fi, often **without internet access**.

- **Zero npm dependencies.** The server uses only Node.js built-ins (`http`, `crypto`, `node:sqlite`).
- **Fully offline.** All styles, icons and fonts are bundled locally.
- **Real-time.** A hand-written RFC 6455 WebSocket server pushes every change to every connected device.
- **Role-based.** Each person only sees, and can only do, what their role allows, and this is enforced on the server.

## ✨ Features

| | |
|---|---|
| 🧾 **Job intake** | Front Desk records the customer, contact number, device, fault note, release date and service payment. Bill numbers are generated automatically. |
| 🔧 **Technician workflow** | The Technician updates progress, logs the components used and marks each job *Successful* or *Unrepairable*. **Prices are never sent to the Technician's device.** |
| ✅ **Manager approval** | The Manager reviews completed jobs, prices components, adds extra fees and confirms the final bill. Confirmed jobs are locked. |
| 🔴 **Live sync** | Every change is broadcast over WebSocket to every logged-in device within milliseconds. |
| 🔐 **PIN login per role** | 4–8 digit PINs are hashed with `scrypt` and a per-role salt, compared in constant time, and rate-limited against brute force. |
| 📜 **Audit trail** | Every login, edit, confirmation and deletion is written to an activity log. Deleted orders are preserved in full inside the log. |
| 💾 **Automatic backups** | A consistent snapshot of the database is taken daily (the last 30 are kept), plus one-click backup download and JSON export. |
| 🖥️ **Device presence** | The Manager can see which laptops are connected and remotely reset another role's PIN, which logs that role out on every device. |
| 📥 **Legacy import** | Imports data from the original single-file HTML version. |

## 🚀 Quick start

**Requirements:** [Node.js](https://nodejs.org) **22.13 or newer** (LTS recommended). Nothing else is needed.

```bash
git clone https://github.com/nhimasara2001-ai/alphatronic-repair-erp.git
cd alphatronic-repair-erp
npm start
```

Then open **http://localhost:8080** on the same machine, or `http://<server-name>:8080` from any device on the same network.

On Windows you can instead double-click [`scripts/Start_Alphatronic_ERP.bat`](scripts/Start_Alphatronic_ERP.bat). For the one-time firewall setup, see the [installation guide](docs/installation.md).

> [!NOTE]
> The first person to select a role (Manager, Front Desk or Technician) sets that role's PIN. The database is created automatically on first start in `./database/`.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP / WebSocket port |
| `ERP_DATA_DIR` | `./database` | Folder for the SQLite database and backups |

### Command-line

```bash
node server.js --reset-pin ceo     # clear a role's PIN (ceo | intake | tech)
```

## 📚 Documentation

| Guide | Description |
|---|---|
| [Installation](docs/installation.md) | Setting up the server laptop, the firewall and the network |
| [User guide](docs/user-guide.md) | Daily workflow for the Front Desk, Technician and Manager |
| [Architecture](docs/architecture.md) | How the server, database, WebSocket protocol and security model work |
| [Troubleshooting](docs/troubleshooting.md) | What to check when other laptops cannot connect |

## 🏗️ Architecture

```
  ┌──────────────────┐        ┌──────────────────┐
  │ Front Desk       │        │ Technician       │
  │ (browser)        │        │ (browser)        │
  └────────┬─────────┘        └────────┬─────────┘
           │   HTTP + WebSocket (LAN)  │
           └────────────┬──────────────┘
                        ▼
        ┌──────────────────────────────────┐
        │  Manager laptop                  │
        │  server.js  (Node.js, port 8080) │
        │    ├─ static files  (public/)    │
        │    ├─ REST: login / backup       │
        │    ├─ WebSocket: actions + sync  │
        │    └─ SQLite (node:sqlite, WAL)  │
        │         database/alphatronic_erp.db
        └──────────────────────────────────┘
```

**Order lifecycle**

```
Pending ──► In Progress ──► Waiting for CEO Confirmation ──► CEO Confirmed (locked)
 (Front Desk)   (Technician)        (Technician)                 (Manager)
```

See [docs/architecture.md](docs/architecture.md) for details.

## 📁 Project structure

```
alphatronic-repair-erp/
├── server.js                 # HTTP + WebSocket server, database, business rules
├── package.json
├── public/
│   ├── index.html            # Single-page web app used by every role
│   └── vendor/               # Bundled Tailwind CSS + Font Awesome (offline use)
├── scripts/
│   ├── Start_Alphatronic_ERP.bat     # Windows launcher
│   └── Allow_Firewall_Access.bat     # One-time firewall setup (run as admin)
├── legacy/
│   └── Alphatronic_Repair_ERP.html   # v2 single-file version (for data export)
├── docs/                     # Full documentation
└── .github/                  # CI, issue/PR templates, code owners
```

## 🔒 Security

- No passwords, keys or customer data are stored in this repository. The `database/` folder is git-ignored.
- The server enforces role permissions on every action. The UI is never trusted.
- The ERP is designed for a **trusted local network**. It serves plain HTTP, so **do not expose port 8080 to the internet**.

To report a vulnerability, please read [SECURITY.md](SECURITY.md). **Do not open a public issue.**

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

All changes reach the `main` branch only through pull requests reviewed and approved by the maintainer. Forks remain fully separate from this original repository.

## 📄 License

Licensed under the [Apache License 2.0](LICENSE). You are free to use, modify and distribute this software. **Any modified file must carry a prominent notice stating that you changed it**, and the Alphatronic name may not be used to endorse derived products. See [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<div align="center">
<sub>Built for the workshop floor by <b>Alphatronic</b>.</sub>
</div>
