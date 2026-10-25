import { randomUUID } from 'node:crypto';
import { defaultRules, taskScore } from './assets/coach-score.js';

export function setupCoachTools({ db, InputError, json, text, integer, body }) {
  db.exec(`CREATE TABLE IF NOT EXISTS coach_sessions(
    id TEXT PRIMARY KEY, date TEXT NOT NULL, label TEXT NOT NULL, ageGroup TEXT NOT NULL,
    rules TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS coach_observations(
    sessionId TEXT NOT NULL REFERENCES coach_sessions(id), entryId TEXT NOT NULL REFERENCES league_entries(id),
    playerName TEXT NOT NULL, role TEXT NOT NULL, stats TEXT NOT NULL, notes TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, updatedAt TEXT NOT NULL, PRIMARY KEY(sessionId,entryId));`);
  const club = 'Prairie Sky FC';
  const session = id => {
    const s = db.prepare('SELECT * FROM coach_sessions WHERE id=?').get(id);
    if (!s) throw new InputError('Session not found.', 404);
    return { ...s, rules: JSON.parse(s.rules) };
  };
  const observation = row => ({ ...row, stats: JSON.parse(row.stats), ...taskScore(row.role, JSON.parse(row.stats), session(row.sessionId).rules) });
  async function handle(req, res, path) {
    if (path === '/api/coach/sessions' && req.method === 'GET') {
      json(res, 200, { sessions: db.prepare('SELECT id,date,label,ageGroup FROM coach_sessions ORDER BY date DESC,createdAt DESC').all(), defaultRules });
      return true;
    }
    if (path === '/api/coach/sessions' && req.method === 'POST') {
      const b = await body(req), date = text(b.date, 'Session date', 10), label = text(b.label, 'Session name', 100);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw new InputError('Enter a valid session date.');
      if (!['U10','U13'].includes(b.ageGroup)) throw new InputError('Choose U10 or U13.');
      const rules = {};
      if (!b.rules || !['Either','Both','Combined'].includes(b.rules.forwardMode)) throw new InputError('Choose a forward scoring mode.');
      rules.forwardMode = b.rules.forwardMode;
      for (const key of ['goals','assists','combined','wingerDuels','passes','defenderDuels']) rules[key] = integer(b.rules[key], 'Task target', 1, 10000);
      const id = randomUUID();
      db.prepare('INSERT INTO coach_sessions VALUES(?,?,?,?,?,?)').run(id,date,label,b.ageGroup,JSON.stringify(rules),new Date().toISOString());
      json(res, 201, { session: session(id) }); return true;
    }
    if (/^\/api\/coach\/sessions\/[^/]+$/.test(path) && req.method === 'GET') {
      const s = session(path.split('/').at(-1));
      const players = db.prepare(`SELECT e.id,e.firstName||' '||e.lastName name FROM league_entries e
        JOIN league_teams t ON t.id=e.teamId WHERE t.club=? AND t.ageGroup=? AND t.active=1 AND e.status='approved'
        ORDER BY e.firstName COLLATE NOCASE,e.lastName COLLATE NOCASE`).all(club,s.ageGroup);
      const observations = db.prepare('SELECT * FROM coach_observations WHERE sessionId=?').all(s.id).map(observation);
      json(res,200,{session:s,players,observations}); return true;
    }
    if (/^\/api\/coach\/sessions\/[^/]+\/players\/[^/]+$/.test(path) && req.method === 'PUT') {
      const parts = path.split('/'), s = session(parts[4]), entryId = parts[6], b = await body(req);
      const player = db.prepare(`SELECT e.firstName||' '||e.lastName name FROM league_entries e JOIN league_teams t ON t.id=e.teamId
        WHERE e.id=? AND e.status='approved' AND t.active=1 AND t.club=? AND t.ageGroup=?`).get(entryId,club,s.ageGroup);
      if (!player) throw new InputError('Player is no longer on this approved team. Refresh the session.',404);
      if (!['Forward','Winger','Defender','Goalkeeper'].includes(b.role)) throw new InputError('Choose a player role.');
      integer(b.version,'Evaluation version',0,Number.MAX_SAFE_INTEGER);
      const stats = {};
      for (const key of ['goals','assists','duels','passes']) stats[key] = integer(b.stats?.[key],key,0,10000);
      const notes = text(b.notes??'','Coach notes',1000,false), now = new Date().toISOString();
      if (b.version === 0) {
        const result = db.prepare('INSERT OR IGNORE INTO coach_observations VALUES(?,?,?,?,?,?,1,?)').run(s.id,entryId,player.name,b.role,JSON.stringify(stats),notes,now);
        if (!result.changes) throw new InputError('Another coach saved this player. Reload the session before saving.',409);
      } else {
        const result = db.prepare(`UPDATE coach_observations SET playerName=?,role=?,stats=?,notes=?,version=version+1,updatedAt=?
          WHERE sessionId=? AND entryId=? AND version=?`).run(player.name,b.role,JSON.stringify(stats),notes,now,s.id,entryId,b.version);
        if (!result.changes) throw new InputError('Evaluation changed. Reload the session before saving.',409);
      }
      json(res,200,{observation:observation(db.prepare('SELECT * FROM coach_observations WHERE sessionId=? AND entryId=?').get(s.id,entryId))}); return true;
    }
    return false;
  }
  return { handle };
}
