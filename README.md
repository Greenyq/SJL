# Super Junior League website

Static website served from the repository root. No build step is required.

## Player statistics

Edit `assets/player-stats.json` to add confirmed season totals. The players array is intentionally empty until real match reports are available. Each record uses this format (example only):

```json
{
  "name": "Player name",
  "club": "Prairie Sky FC",
  "ageGroup": "U10",
  "goals": 0,
  "assists": 0,
  "cleanSheets": 0
}
```

Supported age groups: `U10`, `U13`. Totals must be nonnegative numbers. Use `cleanSheets` for goalkeepers. Goal contributions are calculated as goals plus assists. Rankings are descending, tied totals share rank, and zero totals are omitted. Update a player's existing totals rather than adding duplicate records. Serve over HTTP to load the JSON file.

## Member clubs

The home page includes the six supplied club logos. Prairie Sky FC links to https://prairieskyfc.ca in a new tab. Original logos are preserved; Shakhtar retains its orange background. Matching logo panels accommodate the original backgrounds without altering the crests.
