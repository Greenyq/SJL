import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function setupMatchStats({ db, root, clubs, InputError, json, integer, body }) {
  const schedule = JSON.parse(readFileSync(join(root, 'assets/schedule.json'), 'utf8'));
  const aliases = { Dynamo: 'Dynamo Soccer Club', YFC: 'Youth Football Club', Birds: 'Birds Academy', 'Green Strikers': 'Green Strikers FC' };
  const canonical = name => aliases[name] || name;
  const sides = match => [canonical(match.home), canonical(match.away)];
  db.exec(`CREATE TABLE IF NOT EXISTS match_player_stats(
    matchId TEXT NOT NULL, playerId TEXT NOT NULL REFERENCES players(id),
    club TEXT NOT NULL, goals INTEGER NOT NULL, assists INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, updatedAt TEXT NOT NULL,
    PRIMARY KEY(matchId,playerId));`);
  const eligible = player => !db.prepare(`SELECT e.id FROM league_entries e JOIN league_teams t ON t.id=e.teamId
    WHERE e.statsPlayerId=? AND (e.status<>'approved' OR t.active<>1)`).get(player.id);
  async function handle(req, res, path, scopeClub = null) {
    if (path === '/api/match-stats' && req.method === 'GET') {
      const matches = schedule.matches.filter(m => !scopeClub || sides(m).includes(scopeClub));
      json(res, 200, { matches, clubs: scopeClub ? [scopeClub] : clubs }); return true;
    }
    const route = path.match(/^\/api\/match-stats\/([^/]+)(?:\/players\/([^/]+))?$/);
    if (!route) return false;
    const match = schedule.matches.find(m => m.id === route[1]);
    if (!match || (scopeClub && !sides(match).includes(scopeClub))) throw new InputError('Match not found.', 404);
    if (!route[2] && req.method === 'GET') {
      const requested = new URL(req.url, 'http://localhost').searchParams.get('club');
      if (scopeClub && requested && requested !== scopeClub) throw new InputError('You can manage only your own club.', 403);
      const club = scopeClub || requested || sides(match)[0];
      if (!sides(match).includes(club)) throw new InputError('Choose a club playing this match.');
      const players = db.prepare('SELECT * FROM players WHERE club=? AND ageGroup=? ORDER BY name COLLATE NOCASE').all(club, match.ageGroup).filter(eligible);
      const reports = db.prepare('SELECT playerId,goals,assists,version FROM match_player_stats WHERE matchId=? AND club=?').all(match.id, club);
      json(res, 200, { match, club, players, reports: reports.filter(r => players.some(p => p.id === r.playerId)) }); return true;
    }
    if (route[2] && req.method === 'PUT') {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_protocols'").get() && db.prepare('SELECT matchId FROM match_protocols WHERE matchId=?').get(match.id)) throw new InputError('This match has a referee protocol. Use /referee to edit it; the league administrator can correct a final protocol.', 409);
      const b = await body(req);
      integer(b.goals, 'Match goals', 0, 100); integer(b.assists, 'Match assists', 0, 100);
      integer(b.version, 'Match record version', 0, Number.MAX_SAFE_INTEGER);
      integer(b.playerVersion, 'Player version', 1, Number.MAX_SAFE_INTEGER);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_protocols'").get() && db.prepare('SELECT matchId FROM match_protocols WHERE matchId=?').get(match.id)) throw new InputError('This match has a referee protocol. Use /referee to edit it.', 409);
        const player = db.prepare('SELECT * FROM players WHERE id=?').get(route[2]);
        if (!player || (scopeClub && player.club !== scopeClub) || player.ageGroup !== match.ageGroup || !sides(match).includes(player.club) || !eligible(player)) throw new InputError('Player not found on this match roster.', 404);
        const previous = db.prepare('SELECT * FROM match_player_stats WHERE matchId=? AND playerId=?').get(match.id, player.id);
        if (player.version !== b.playerVersion || (previous?.version || 0) !== b.version) throw new InputError('Statistics changed. Refresh this match before saving.', 409);
        if (previous && previous.club !== player.club) throw new InputError('Player changed clubs. Contact the league administrator to correct this match.', 409);
        const goals = player.goals + b.goals - (previous?.goals || 0), assists = player.assists + b.assists - (previous?.assists || 0);
        if (goals < 0 || assists < 0 || goals > 10000 || assists > 10000) throw new InputError('Season totals conflict with this correction. Ask the league administrator to review the totals.', 409);
        db.prepare('UPDATE players SET goals=?,assists=?,version=version+1 WHERE id=?').run(goals, assists, player.id);
        db.prepare(`INSERT INTO match_player_stats VALUES(?,?,?,?,?,1,?) ON CONFLICT(matchId,playerId)
          DO UPDATE SET goals=excluded.goals,assists=excluded.assists,version=match_player_stats.version+1,updatedAt=excluded.updatedAt`).run(match.id, player.id, player.club, b.goals, b.assists, new Date().toISOString());
        db.exec('COMMIT');
        json(res, 200, { player: db.prepare('SELECT * FROM players WHERE id=?').get(player.id), report: db.prepare('SELECT playerId,goals,assists,version FROM match_player_stats WHERE matchId=? AND playerId=?').get(match.id, player.id) }); return true;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    throw new InputError('Endpoint not found.', 404);
  }
  return { handle };
}
