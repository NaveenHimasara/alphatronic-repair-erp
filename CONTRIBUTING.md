# Contributing to Alphatronic Repair ERP

Thank you for your interest in improving this project! This guide explains how contributions work and how the original code is protected.

## How changes reach this repository

This repository is open source, but **only the maintainer can change the official code**. Changes from the community always go through this process:

```
 Your fork (your own copy)  ──►  Pull Request  ──►  Maintainer review  ──►  merged into main
```

1. **Fork** the repository. This creates a separate copy under your own GitHub account; the original is not affected.
2. **Create a branch** in your fork: `git checkout -b fix/short-description`
3. **Make your change** and test it locally (see below).
4. **Open a Pull Request** against `main`. Fill in the template.
5. The maintainer reviews it. Nothing is merged without **explicit approval from a code owner**, and the `main` branch is protected against direct pushes and force-pushes.

Every merged change is visible forever in the commit history, together with its author.

## License requirements for modified files

This project uses the [Apache License 2.0](LICENSE). If you distribute a modified version (including in your fork), you must:

- keep the `LICENSE` and `NOTICE` files,
- add a **prominent notice in every file you changed**, for example:
  ```js
  // Modified by <your name>, <date>: <what you changed>
  ```
- not use the name **Alphatronic** to promote your modified version without permission.

## Development setup

```bash
git clone https://github.com/<your-username>/alphatronic-repair-erp.git
cd alphatronic-repair-erp
npm start            # requires Node.js >= 22.13
```

To keep your test data separate from a real shop database:

```bash
ERP_DATA_DIR=./tmp-data PORT=8090 node server.js
```

### Before opening a Pull Request

- [ ] `node --check server.js` passes
- [ ] The server starts and `http://localhost:8080` works
- [ ] You tested the change with **each affected role** (Manager / Front Desk / Technician)
- [ ] The Technician role still never receives prices
- [ ] No database files, customer data, passwords or keys are committed
- [ ] Documentation in `docs/` is updated if behavior changed

## Code style

- Plain Node.js (CommonJS, `'use strict'`) with **no new npm dependencies** unless discussed first.
- 4-space indentation, single quotes, semicolons (see `.editorconfig`).
- Every permission check belongs on the **server**. Never rely only on hiding a button.
- Keep the app working **fully offline**: no CDN links.

## Commit messages

Use short, imperative messages, e.g. `Add extra-fee field to invoice`, `Fix PIN lockout timer`.

## Reporting bugs and requesting features

Use the [issue templates](../../issues/new/choose). For security problems, **do not open an issue**; follow [SECURITY.md](SECURITY.md).

By contributing, you agree that your contributions are licensed under the Apache License 2.0 and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
