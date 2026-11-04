# Scripts

## Convex backups

`backup-convex.ps1` exports every table to `backups\convex-<target>-<date>.zip` (git-ignored)
and keeps the newest 8.

```powershell
powershell -File scripts\backup-convex.ps1        # prod
powershell -File scripts\backup-convex.ps1 -Dev   # dev
```

**What is at stake:** the `users` table (accounts) and `devices` (pairings). Summaries are only
7 days of history, so losing them costs little. Losing `users` means everyone signs up and
pairs again.

**How often:** weekly, and always before a schema change or a manual prod data fix.
To run it weekly on this PC, create a task in Task Scheduler that runs
`powershell -File "<repo>\scripts\backup-convex.ps1"` (the PC must be logged in to Convex).

**Keep it private:** the ZIP holds email addresses, password hashes and device-secret hashes.
Don't upload it anywhere public or send it in chat.

### Restore

Restoring overwrites live data, so test on dev first:

```powershell
cd convex
npx convex import --replace-all ..\backups\convex-prod-<date>.zip          # into dev, to check
npx convex import --prod --replace-all ..\backups\convex-prod-<date>.zip   # into prod
```

After restoring prod, devices paired after the backup must be paired again, and accounts
created after it are gone.
