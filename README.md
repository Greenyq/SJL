# Super Junior League

Node 24+ application with a responsive home page, the six supplied member club logos, registrations, player leaderboards and an administrator dashboard. No third-party runtime dependencies or frontend build are required.

## Local development

Run `npm start` and open http://localhost:3000. The server creates `.data/sjl.sqlite`, which is ignored by Git. Set `ADMIN_PASSWORD` in your shell environment to a secret of at least 16 characters to enable the dashboard at `/admin`. Do not put the password in source code, a URL or a tracked file. If it is not configured, admin login remains disabled.

Run `npm test` for HTTP integration tests, including validation, admin access, privacy, concurrent edits and persistence across a server restart.

## Registration

The club form collects club name, location and one or more team age groups. The player form collects name, age, experience and an optional preferred member club. Both offer an optional contact email. Registrations are saved in SQLite and shown only after administrator login. They do not automatically create public clubs, player statistics or schedule entries.

## Administrator

At `/admin`, sign in with the configured `ADMIN_PASSWORD`. Add a player and select the club and U10/U13 division. Enter **season totals** for goals, assists and goalkeeper clean sheets. Edit the player's existing row for later updates. Goal contributions are calculated as goals plus assists; equal totals share rank. The public website fetches saved totals from `/api/stats` when loaded, so reload an open public page after saving changes.

Concurrent updates use row versions. If another administrator changed the record, the server refuses to overwrite it. Refresh the list, reopen the player and apply the intended changes to the latest totals. Sessions use HttpOnly, SameSite cookies and expire after eight hours. They are invalidated on logout and server restart.

The **Registrations** tab displays club and player applications and their contact details. The public API never returns application data. The initial statistics seed is intentionally empty. `assets/player-stats.json` is imported once when a new database is initialized; subsequent edits must use the dashboard.

## Schedule

`assets/schedule.json` contains the Schedule sheet from `Super_Junior_League_Schedule_and_Costs(1).xlsx`: 14 dates, 42 matches, October 25, 2026 through January 31, 2027, 19:30–20:30 Winnipeg time, two U10 fields and one U13 field. The source does **not** include YFC fixtures. The website retains that schedule exactly and offers matchday, age and club filters. Club names in the UI are normalized to the member-club names, but fixtures retain their original source labels.

To import a replacement workbook, run `python scripts/import-schedule.py /absolute/path/to/schedule.xlsx` from the repository root and review the resulting JSON. The importer expects the Schedule sheet first and the supplied Date/Time/U10 Field 1/U10 Field 2/U13 Field 3 layout.

## Render deployment

A static Render site cannot run the registration API, database or authenticated admin dashboard. `render.yaml` prepares a **Node web service** with a persistent disk. Render runtimes are immutable: if the existing SJL service is static, provision the web service, verify it, then switch the website link/domain. Do not assume merging this PR changes a static site's hosting type.

The blueprint uses a paid `starter` web service and a 1 GB disk and is a configuration proposal only. It has not been provisioned. Confirm the target workspace and hosting plan before applying it.

Production settings:

- Node 24; build `npm ci`; start `npm start`; health check `/health`.
- `NODE_ENV=production`.
- `DATA_DIR=/var/data/sjl`, backed by a mounted persistent disk.
- `ADMIN_PASSWORD`: enter a private password of at least 16 characters in Render's environment settings. The blueprint prompts for it and does not contain a password.
- Optional `PUBLIC_ORIGIN`: the final HTTPS origin, e.g. `https://your-league-domain.example`, for strict origin validation.

The app binds to Render's `PORT` on `0.0.0.0`. Production refuses startup if the data directory or admin password is missing. Use one server instance with the attached disk. Without persistent storage, registrations and statistics would be lost on redeploy. Back up the SQLite database using SQLite's backup API or a consistent volume snapshot; copying only the live `.sqlite` file without its WAL is not a reliable backup. Do not publish the database or commit it to Git.

## Club logos

Prairie Sky FC links to https://prairieskyfc.ca. Original logos are preserved and displayed on matching background panels. Shakhtar retains its orange background. The original Canva background-removal attempt required a paid plan.
