# Installation

Alphatronic Repair ERP has one **server** (usually the Manager's laptop) and any number of **client** devices, which need only a web browser.

```
   Front Desk laptop ─┐
                      ├── Wi-Fi ──►  Server laptop (Manager)
   Technician laptop ─┘              server.js  +  database/alphatronic_erp.db
```

## Requirements

| | |
|---|---|
| Server | Windows 10/11, Linux or macOS with **Node.js 22.13+** |
| Clients | Any modern browser (Chrome, Edge, Firefox, Safari) |
| Network | All devices on the same LAN / Wi-Fi |
| Internet | Not required |

## 1. Install Node.js (server only)

Download the **LTS** version from <https://nodejs.org> and install it with the default options. To check the installation:

```bash
node --version   # must print v22.13.0 or newer
```

## 2. Get the code

```bash
git clone https://github.com/nhimasara2001-ai/alphatronic-repair-erp.git
```

Or download the ZIP from the green **Code** button on GitHub and extract it.

## 3. Allow network access (Windows, one time)

Right-click [`scripts/Allow_Firewall_Access.bat`](../scripts/Allow_Firewall_Access.bat) and choose **Run as administrator**. The script:

1. Removes any old Windows Firewall rules that **block** Node.js.
2. Switches the active Wi-Fi / Ethernet profile from *Public* to *Private*.
3. Allows inbound TCP port **8080** on Private and Domain networks only.

To do it by hand instead, open *Settings → Network & internet → Wi-Fi → (your network)*, set **Network profile type** to **Private**, and allow port 8080 in Windows Defender Firewall.

## 4. Start the server

| Platform | Command |
|---|---|
| Windows | Double-click `scripts/Start_Alphatronic_ERP.bat` |
| Any | `npm start` (or `node server.js`) in the project folder |

The console prints the addresses to use:

```
==================================================================
  ALPHATRONIC REPAIR ERP - SERVER RUNNING
==================================================================
  On THIS laptop open     :  http://localhost:8080
  On the OTHER laptops    :  http://<SERVER-NAME>:8080
  (fallback, current IP)  :  http://192.168.x.x:8080
==================================================================
```

Keep this window open. Closing it stops the ERP for everyone.

## 5. Connect the other devices

On each client, open `http://<SERVER-NAME>:8080` and bookmark it. The name-based link keeps working even when the router gives the server a new IP address. The Manager screen also shows these links under **Laptops & Access**.

## Optional configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Listening port |
| `ERP_DATA_DIR` | `./database` | Where the database and backups are kept |

```powershell
# Windows PowerShell example
$env:ERP_DATA_DIR = "D:\AlphatronicData"; node server.js
```

## Moving to another shop or computer

Copy the project folder **without** the `database` folder, or clone it from GitHub. A fresh, empty database is created on first start.

To move existing data, copy `database/alphatronic_erp.db` while the server is **stopped**, or use **Download Backup** on the Manager screen.
