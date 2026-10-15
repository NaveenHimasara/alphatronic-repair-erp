# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [3.0.0] - 2026-09-23

### Added
- Multi-laptop LAN server (`server.js`) with zero npm dependencies.
- SQLite database (`node:sqlite`, WAL mode) replacing browser storage.
- Real-time sync between all devices over a built-in WebSocket server.
- Role-based PIN login (Manager, Front Desk, Technician) with `scrypt` hashing and brute-force lockout.
- Server-side permission checks; prices are never sent to the Technician role.
- Activity log / audit trail for every action.
- Automatic daily backups (30 kept), backup download, JSON export, and import from v2.
- Connected-device presence and remote PIN reset for the Manager.
- Windows launcher and firewall setup scripts.
- Bundled Tailwind CSS and Font Awesome for fully offline use.

## [2.0.0]

### Added
- Single-file HTML version storing data in the browser (kept in `legacy/`).
