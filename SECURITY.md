# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 3.x (LAN server) | ✅ |
| 2.x (single-file HTML, `legacy/`) | ❌ Reference only |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report them privately through GitHub instead:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the steps to reproduce it, and its possible impact.

You will receive an acknowledgement within **7 days**. Please give us reasonable time to release a fix before you disclose the issue publicly.

## Deployment guidance

Alphatronic Repair ERP is designed for a **trusted local network** (a shop's private Wi-Fi):

- Do **not** forward port 8080 on your router or expose the server to the internet. Traffic is plain HTTP.
- Keep the Wi-Fi network profile set to **Private** and use WPA2/WPA3 with a strong Wi-Fi password.
- Use a separate guest network for customers.
- Choose PINs that are not easy to guess (avoid `1234`, `0000`, birthdays).
- Keep regular copies of `database/backups/` on a separate drive.
- Never commit the `database/` folder or backup files to Git. They contain customer data.

## Security features

See the [security model in the architecture guide](docs/architecture.md#security-model).
