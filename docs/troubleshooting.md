# Troubleshooting

## Other laptops cannot connect

Work through these in order:

1. **Is the server running?** The black server window must be open on the server laptop.
2. **Does it work locally?** On the server laptop, open `http://localhost:8080`. If it works, the server is fine and the problem is the network.
3. **Same network?** All devices must be on the **same Wi-Fi**, not a *Guest* network.
4. **Firewall:** run `scripts/Allow_Firewall_Access.bat` as administrator and make sure the Wi-Fi profile is **Private**.
5. **Name vs IP:** if `http://<SERVER-NAME>:8080` does not open, use the IP address printed in the server window. For a permanent fix, give the server a fixed IP in your router (*DHCP reservation*).
6. **Client isolation:** some routers have **AP / client isolation** turned on, which stops devices from reaching each other. Turn it off in the router settings.

## "Port 8080 is already in use"

The server is probably already running in another window. Open `http://localhost:8080`, or close the other window first. To use a different port:

```bash
PORT=8090 node server.js          # Linux / macOS
$env:PORT=8090; node server.js    # Windows PowerShell
```

## "Cannot find module 'node:sqlite'"

Your Node.js is too old. Install Node.js **22.13 or newer**.

## Forgotten Manager PIN

```bash
node server.js --reset-pin ceo
```

## A device was logged out unexpectedly

The Manager reset that role's PIN, or the session was removed. Log in again. If the role has no PIN, the next login sets a new one.

## Restoring a backup

1. Stop the server.
2. Rename the current `database/alphatronic_erp.db` (keep it, just in case).
3. Copy the backup file to `database/alphatronic_erp.db`.
4. Delete any `alphatronic_erp.db-wal` and `alphatronic_erp.db-shm` files next to it.
5. Start the server.
