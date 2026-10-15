# User guide

## Roles

| Role | Internal name | Can do |
|---|---|---|
| **Manager** | `ceo` | Everything: create jobs, update repairs, price and confirm bills, delete jobs, reset PINs, view the activity log, back up and import data |
| **Front Desk** | `intake` | Create new repair jobs and see their status and price |
| **Technician** | `tech` | Update repair progress, log components, set the result. **Never sees prices.** |

## Logging in

1. Open the ERP link and choose who you are.
2. **First time for a role:** the first person to choose a role creates its PIN (4–8 digits) and types it twice.
3. **After that:** enter the PIN. Five wrong attempts lock that device out for one minute.
4. The device stays logged in until someone presses **Log out**.

### Forgotten PIN

- **Front Desk / Technician:** the Manager resets it under **Laptops & Access**. That role is logged out everywhere, and the next login sets a new PIN.
- **Manager:** on the server computer, run:
  ```bash
  node server.js --reset-pin ceo
  ```

## Job lifecycle

```
 ┌─────────┐  Technician  ┌─────────────┐  Technician  ┌─────────────────────┐  Manager  ┌───────────────┐
 │ Pending │ ───────────► │ In Progress │ ───────────► │ Waiting for Manager │ ────────► │ CEO Confirmed │
 └─────────┘  starts work └─────────────┘  completes   │ confirmation        │  confirms │   (locked)    │
  Front Desk                                           └─────────────────────┘           └───────────────┘
  creates job
```

### Front Desk: new job

Fill in the bill number (suggested automatically, e.g. `ORD-1042`), customer name, contact number, product, fault note, release date and service payment. Then save. The job appears on every screen immediately.

### Technician: repair

Open a job and:
- add components used (SKU / name and quantity),
- write comments,
- save as **In Progress**, or mark it **Completed** with the result *Successful* or *Dead / Unrepairable*.

Completed jobs move to the Manager for confirmation. Once the Manager confirms a job, it is locked for the Technician.

### Manager: confirm and bill

Review completed jobs, set the unit price for each component, adjust the service charge, add any extra fee, and confirm. The total is calculated automatically.

## Data and backups

| What | Where |
|---|---|
| Live database | `database/alphatronic_erp.db` |
| Automatic daily backups (last 30 kept) | `database/backups/` |
| Manual backup | Manager → **Download Backup** (`.db` file) |
| Export | Manager → **Export JSON** |
| Audit trail | Manager → **Activity Log** |

### Importing from the old single-file version

1. On the old laptop, open `legacy/Alphatronic_Repair_ERP.html` and click **Backup Data** to save a `.json` file.
2. On the Manager screen, click **Import Old Backup** and choose that file.

Bill numbers that already exist are skipped. A safety backup is taken automatically before every import.
