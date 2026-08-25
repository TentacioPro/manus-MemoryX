# Windows setup and local operation

## Prerequisites

Install Docker Desktop for Windows and use its Linux-container mode. The current Docker documentation describes WSL 2 as the default Windows backend for most users and provides the system requirements and installation steps. [1]

Open PowerShell in the project folder. Copy the local template and set unique local passwords before you start:

```powershell
Copy-Item ops/local-config.template .env
notepad .env
```

Start the complete local stack with the script below. On the first run, pass `-Build` to create the web, API, and worker images.

```powershell
.\scripts\start.ps1 -Build
```

Open `http://localhost:5173` for the archive UI. The MinIO administrator console is available only on the same computer at `http://localhost:9001`. The app is local by default and does not publish the database or Redis outside Docker.

## Everyday commands

| Activity | PowerShell command | Result |
|---|---|---|
| Start | `.\scripts\start.ps1` | Starts the previous local stack and preserves volumes |
| Stop | `.\scripts\stop.ps1` | Stops containers while retaining MongoDB, MinIO, and Redis volumes |
| Update images | `.\scripts\upgrade.ps1` | Pulls/builds newer images and restarts the stack while retaining volumes |
| Portable backup | `.\scripts\backup.ps1` | Exports MongoDB data, JSON/CSV metadata, and all MinIO media to a timestamped folder |
| Restore backup | `.\scripts\restore-backup.ps1 -BackupDirectory .\backups\YYYYMMDD-HHMMSS -ReplaceExisting` | Replaces the current local MongoDB and MinIO contents with a selected backup |
| View service state | `docker compose ps` | Displays health and running status |
| View a service log | `docker compose logs -f api` | Streams API logs; replace `api` with `worker`, `web`, `mongo`, `minio`, or `redis` |

> Do not run `docker compose down -v` unless you intentionally want to remove **all** local archive data. The `-v` flag deletes the persistent data volumes.

## Local import preparation

Place source files in `local-imports/incoming`. Keep original exports intact until the review stage is complete. The import workflow will copy import archives and associated media into MinIO and store only their object references and checksums in MongoDB.

WhatsApp exports may be TXT files or ZIP archives with a chat TXT file and local media. Instagram input must come from the official **Export to device** option in Accounts Center; the data and media categories available are determined by the options selected while requesting the export. [2] Google Takeout can create ZIP or TGZ archives for selected product data and may split a large request into multiple archive files. [3]

The app will not sign in to any platform, use platform APIs, scrape pages, simulate activity, or run browser bots. If a post or video is not available in an export, paste its URL manually or load a CSV instead.

## Queue an import from PowerShell

After starting the stack, use the command below to copy a local archive into the intake folder and queue it for local processing. The job remains in a review-required state after parsing; it does not auto-commit content.

```powershell
.\scripts\queue-local-import.ps1 -FilePath "C:\Exports\WhatsAppChat.zip" -Kind whatsapp -SourceLabel "Exploration group"
```

For the supplied WhatsApp export, replace `C:\Exports\WhatsAppChat.zip` with the location where you saved the ZIP after downloading this project. Use `-Kind instagram` for a locally downloaded Instagram information export, `-Kind youtube` for a Google Takeout archive, and `-Kind csv` for a manual URL-capture CSV.

## Backup, export, and recovery

Run the following command whenever you want a portable copy before a major upgrade or after a large import. It creates `backups\YYYYMMDD-HHMMSS` with a compressed MongoDB archive, JSON exports for all archive collections, a CSV of entry metadata, a full MinIO media mirror, and a manifest.

```powershell
.\scripts\backup.ps1
```

To export metadata only, for example for a spreadsheet or an external read-only copy, run the command below. The JSON records retain source provenance and object references; the CSV is designed for lightweight inspection.

```powershell
.\scripts\export-metadata.ps1 -IncludeCsv
```

> A restore replaces the live local archive. Always make a fresh backup first, stop any active import review, and inspect the target directory before using `-ReplaceExisting`.

```powershell
.\scripts\restore-backup.ps1 -BackupDirectory ".\backups\20260825-020000" -ReplaceExisting
```

For a fully local, deterministic daily backup, register a Windows Task Scheduler job. This requires no account, paid API, or external service; Docker Desktop must be running at the scheduled time.

```powershell
.\scripts\register-backup-task.ps1 -Time "02:00"
```

To remove the task later, run `schtasks /Delete /TN KnowledgeVaultDailyBackup /F`. Alternatively, run `.\scripts\backup.ps1` from any preferred local scheduler or a Docker host timer; the script uses only the local Docker Compose stack.

## Validate the local installation

On the Windows computer that will hold the archive, the following non-destructive command verifies the local API, exports metadata, creates a portable backup, and checks the expected output files. It does **not** run the destructive restore command.

```powershell
.\scripts\verify-local-stack.ps1 -StartIfNeeded
```

After inspecting the backup, you may perform a restore validation in a disposable copy of the stack. Do not run the restore command against your only live archive unless you have made and checked a fresh backup first.

## References

[1]: https://docs.docker.com/desktop/setup/install/windows-install/ "Docker Docs — Install Docker Desktop on Windows"
[2]: https://help.instagram.com/181231772500920/ "Instagram Help Center — Review and export a copy of your Instagram information"
[3]: https://support.google.com/accounts/answer/3024190?hl=en "Google Account Help — How to download your Google data"
