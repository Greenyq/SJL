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

## Club access and private coaching tools

`/admin` remains the league-wide **Super Admin** portal, using the existing administrator password. In **Club Access**, enable one account for each of the six existing clubs and set its password (16–128 characters). Accounts start disabled with no default password. Share each club's password privately. Saving access settings, disabling an account or resetting its password revokes all sessions for that club. Version checks prevent overwriting another administrator's account change.

Club managers sign in at `/club`. They can create/edit their own season-statistics rows, review their own player applications, correct names, archive/restore registrations and move players between their own teams/age groups. Only Super Admin can transfer a player to a different club, read general league interest registrations, configure league email or manage club credentials. API authorization derives ownership from the authenticated session and stored player/team records. Club responses omit signatures, policy history, account identifiers and email-delivery details. Parent contact details are shown only where sharing with the selected club was acknowledged.

Club credentials use independent salted scrypt hashes. Club sessions use hashed random tokens in SQLite, HttpOnly/SameSite cookies and Secure cookies in production, with an eight-hour expiry. They survive application restart; parent and super-admin credentials/sessions retain their existing behavior.

**Coach Tools** is available to Prairie Sky FC and Super Admin only. Create a dated U10/U13 match or training session, then evaluate the existing approved registrations in that team. No player names are imported or duplicated from the supplied roster posters. Choose a role, record actions using counters or numeric inputs, add notes and explicitly **Save Evaluation**. The tool warns before discarding an unsaved player evaluation. Sessions and evaluations persist in the existing database; optimistic row versions prevent overwriting a concurrent coach's changes. CSV export contains saved evaluations for the selected session.

Targets are saved separately for each new coaching session, preserving historical scoring:

- Forward: default 3 goals **OR** 3 assists. Optional modes require both targets or 3 combined goals + assists.
- Winger: 2 duels won and 4 completed passes, each worth half the rating. Excess on one task cannot compensate for the other.
- Defender: 5 duels won.
- Goalkeeper: notes only until goalkeeper tasks are defined.

Rating equals capped task completion × 10, rounded to one decimal. A player without a saved evaluation is not scored. Earlier observations remain readable when the roster changes, using the saved name; saving is allowed only for players currently approved in the session's club/division. Coach evaluations do not change public league totals and are never included in public rosters, parent profiles or public statistics.

Run `npm test` for club ownership boundaries, credential reset/revocation, restart persistence, concurrent edits and scoring modes. Browser interaction checks require a locally available Playwright Chromium browser; a screenshot-based review has not yet been completed in the authoring environment.

## Schedule

`assets/schedule.json` contains 14 dates and 42 matches, October 25, 2026 through January 31, 2027, 19:30–20:30 Winnipeg time, two U10 fields and one U13 field. The original workbook omitted YFC; the corrected fixtures include YFC in both divisions. U10 has six teams playing 9–10 games each, with every pairing occurring once or twice. U13 has four teams playing seven games each, with every pairing occurring two or three times. Shakhtar U13 rests on October 25. Dates, times and field capacity are unchanged. Home/away totals differ by at most one per team, no team plays twice on a matchday, and no team has three consecutive byes except Prairie Sky U10 on Dec 20 / Jan 3 / Jan 10 after the organizer-requested opening fixture swap. Prairie Sky U10 vs Birds now plays Oct 25; Dynamo vs Birds takes Jan 3. Club names in the UI are normalized to the member-club names; fixtures retain source aliases (including YFC).

To import a replacement workbook, run `python scripts/import-schedule.py /absolute/path/to/schedule.xlsx` from the repository root and review the resulting JSON. A workbook import replaces the corrected fixtures, so verify division membership and run `npm test` before publishing. The importer expects the Schedule sheet first and the supplied Date/Time/U10 Field 1/U10 Field 2/U13 Field 3 layout.

## Render deployment

A static Render site cannot run the registration API, database or authenticated admin dashboard. `render.yaml` prepares a **Node web service** with a persistent disk. Render runtimes are immutable: if the existing SJL service is static, provision the web service, verify it, then switch the website link/domain. Do not assume merging this PR changes a static site's hosting type.

The live application runs on the paid `starter` Node web service with a 1 GB persistent disk in the BNL League workspace. The blueprint describes that configuration.

The live `super-junior-league-app` service auto-deploys from `codex/sjl-clubs-player-stats`. Release application changes to that branch. The separate `super-junior-league` static redirect tracks `main`; a successful deployment there does not update the live application.

Production settings:

- Node 24; build `npm ci`; start `npm start`; health check `/health`.
- `NODE_ENV=production`.
- `DATA_DIR=/var/data/sjl`, backed by a mounted persistent disk.
- `ADMIN_PASSWORD`: enter a private password of at least 16 characters in Render's environment settings. The blueprint prompts for it and does not contain a password.
- Optional `PUBLIC_ORIGIN`: the final HTTPS origin, e.g. `https://your-league-domain.example`, for strict origin validation.

The app binds to Render's `PORT` on `0.0.0.0`. Production refuses startup if the data directory or admin password is missing. Use one server instance with the attached disk. Without persistent storage, registrations and statistics would be lost on redeploy. Back up the SQLite database using SQLite's backup API or a consistent volume snapshot; copying only the live `.sqlite` file without its WAL is not a reliable backup. Do not publish the database or commit it to Git.

## Club logos

Prairie Sky FC links to https://prairieskyfc.ca. Original logos are preserved and displayed on matching background panels. Shakhtar retains its orange background. The original Canva background-removal attempt required a paid plan.

## Parent accounts and league roster

`/league-register` provides two stages: English league documents and acknowledgements, then player details, optional media permissions and a confirmed team. `/parent` lets a parent sign in, view multiple children and change media/interview/public-statistics permissions. The original club and prospective-player interest forms remain separate.

Accounts use asynchronously derived scrypt password hashes with unique salts, hashed recovery codes and HttpOnly/SameSite/Secure production cookies. Parent sessions last seven days and persist in SQLite; admin sessions remain separate. A private recovery code is displayed once at signup. Account recovery rotates that code and invalidates earlier sessions. Email verification and email reset delivery are not configured: the administrator must verify the guardian and club roster before approving registration. Do not ask parents to share passwords or recovery codes.

The **League Roster** admin tab shows registrations, guardian details, signed document version and permission history. Confirm the guardian and team roster, then either create a zero-total statistics row or explicitly select an existing matching player. Statistics are linked by stable player ID, never automatically by a claimed name. A statistics row can belong to only one league profile. Update goals, assists and clean sheets in **Player Statistics**; the parent profile reads the same row and refreshes every 30 seconds while visible. Linked player identity fields cannot be changed through the statistics editor. Declined entries remain visible to their parent with the review note.

New league profiles appear in the public statistics API only with the separate public-statistics permission. Guardian details, birth year and permissions never appear in that API. Permission changes are audited. Existing standalone statistics rows remain governed by the original administrator workflow.

Teams initially come from the corrected schedule (ten teams). Add further confirmed teams in **League Roster → Add a League Team**. Adding a team does not invent fixtures or modify the source schedule.

`assets/league-policies.json` contains English registration editions of the three supplied documents and a separate media permission/participation acknowledgement. No liability release was supplied, so the media form does not purport to waive liability or guarantee insurance. The league stores the accepted document payload/hash/version, typed guardian name and timestamp. Change the version when changing policy text; prior snapshots remain in `league_policy_versions`. Financial and team-count figures in the translated regulations reflect the supplied document rather than being recalculated.


### Team schedules and club email notifications

Each private player profile includes only fixtures matching its registered club and age group, using the imported schedule and Winnipeg time. Upcoming and past fixtures are separate; new teams without fixtures show an honest empty state. Original schedule aliases are normalized before filtering.

New league registrations require a parent phone and an explicit acknowledgement that registration/contact information is shared with the selected club. Parent email/name come from the signed-in account. The notification includes player name, birth year, team, parent name/email/phone and media choices. No passwords or recovery codes are sent. Existing registrations remain intact, with no retroactive notification or inferred sharing permission.

Private club recipient addresses are seeded from the organizer's screenshot and confirmed Green Strikers mapping; YFC uses `yfcsocceracademy@gmail.com`. Edit recipient addresses in **Admin → League Roster → Club Email Notifications**. Only the selected club receives a message, with the parent's email as Reply-To.

Sending requires **Resend** setup:

1. Verify your sending domain in Resend using its supplied DNS records. Prefer a dedicated sending subdomain; do not replace the website's A/CNAME records or existing mailbox MX records.
2. Create a sending API key and set `RESEND_API_KEY` in the Render Node service's Environment (never commit it or put it in browser code).
3. Set `CLUB_MAIL_FROM` to a sender on that verified domain, e.g. `Super Junior League <registrations@notify.superjuniorleague.ca>`.
4. After Render restarts, queued notifications are processed automatically. Verify acceptance in Admin and delivery in Resend logs.

The SQLite outbox is written atomically with registration and survives restart. Without sending credentials messages remain queued. Failures retry with bounded backoff and the same Resend idempotency key, up to 23 hours after first attempt; uncertain older sends stop at `needs_review` so they cannot silently duplicate beyond the provider's 24-hour retention window. Check provider logs before resolving those manually. `accepted` means the provider accepted the message, not verified inbox delivery. Admin can retry unsent/failed/blocked messages. Recipient changes affect only notifications with no attempted sends. Registration never depends on the provider being available.

Each new registration also queues a separate parent receipt to the signed-in account email, with player/team details, permission choices and a clear pending-review status. Parent and club notifications have independent recipients, retry keys and delivery statuses; admin displays both. Changing a club recipient never redirects parent receipts. The schema migration preserves existing club messages and their provider/idempotency identifiers without adding retroactive parent messages.

Shareable league player registration URL: `https://superjuniorleague.ca/registration-player`. The `/league-register` route remains a compatible alias.

### Club rosters and review filters

The **League Roster** admin view opens with **Awaiting approval** selected. Filter by club, U10/U13, status and player/guardian name. Filters remain selected after reviews and refreshes; **Reset filters** clears club/age/search and returns to pending applications. Email configuration is in a collapsible panel below the applications.

Click any member-club card on the homepage to open its roster and season statistics, with U10/U13 tabs and a link to that club's schedule. Prairie Sky's external website remains available through a separate link. `/api/league/rosters` returns only approved registrations on active teams with public-statistics permission, using an explicit allowlist of name and season totals. Pending, declined, nonconsenting and unlinked statistics-only records are excluded. No parent details, birth year, signature or permission history are sent to public pages. Withdrawal hides the player on the next roster request.

On startup, newly scheduled club/age pairs are added to registration without duplicating existing teams or reactivating disabled teams. Existing registrations, accounts and statistics remain intact.
