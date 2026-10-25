import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const lifetime = 8 * 60 * 60 * 1000;

export function setupClubAccess({ db, clubs, InputError, json, text, integer, rate, body, cookieSecure, requireAdmin }) {
  db.exec(`CREATE TABLE IF NOT EXISTS club_accounts(
    club TEXT PRIMARY KEY, passwordHash TEXT, salt TEXT, enabled INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1, updatedAt TEXT);
    CREATE TABLE IF NOT EXISTS club_sessions(
    tokenHash TEXT PRIMARY KEY, club TEXT NOT NULL REFERENCES club_accounts(club), expires INTEGER NOT NULL);
  `);
  for (const club of clubs) db.prepare('INSERT OR IGNORE INTO club_accounts(club) VALUES(?)').run(club);
  const tokenKey = req => {
    const value = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('sjl_club='))?.slice(9);
    return value ? hash(value) : '';
  };
  const setCookie = (res, token, maxAge = lifetime / 1000) => res.setHeader('Set-Cookie',
    `sjl_club=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${cookieSecure ? '; Secure' : ''}`);
  function requireClub(req) {
    const account = db.prepare(`SELECT a.club FROM club_sessions s JOIN club_accounts a ON a.club=s.club
      WHERE s.tokenHash=? AND s.expires>? AND a.enabled=1`).get(tokenKey(req), Date.now());
    if (!account) throw new InputError('Sign in to your club account.', 401);
    return account;
  }
  async function handle(req, res, path) {
    if (path === '/api/admin/club-accounts' || path === '/api/admin/club-accounts/password') {
      requireAdmin(req);
      if (path === '/api/admin/club-accounts' && req.method === 'GET') {
        return json(res, 200, { accounts: db.prepare('SELECT club,enabled,version,updatedAt FROM club_accounts ORDER BY club').all() }), true;
      }
      if (path === '/api/admin/club-accounts/password' && req.method === 'PUT') {
        const b = await body(req);
        if (!clubs.includes(b.club)) throw new InputError('Choose a league club.');
        integer(b.version, 'Account version', 1, Number.MAX_SAFE_INTEGER);
        if (typeof b.enabled !== 'boolean') throw new InputError('Choose whether club access is enabled.');
        let digest, salt;
        if (b.password) {
          if (typeof b.password !== 'string' || b.password.length < 16 || b.password.length > 128) throw new InputError('Use a club password of 16–128 characters.');
          salt = randomBytes(16).toString('hex');
          digest = (await derive(b.password, salt, 64)).toString('hex');
        }
        const current = db.prepare('SELECT * FROM club_accounts WHERE club=?').get(b.club);
        if (!digest && b.enabled && !current.passwordHash) throw new InputError('Set a password before enabling this club.');
        db.exec('BEGIN IMMEDIATE');
        try {
          const changed = db.prepare(`UPDATE club_accounts SET passwordHash=?,salt=?,enabled=?,updatedAt=?,version=version+1
            WHERE club=? AND version=?`).run(digest || current.passwordHash, salt || current.salt, Number(b.enabled), new Date().toISOString(), b.club, b.version);
          if (!changed.changes) throw new InputError('Club access changed. Refresh before saving.', 409);
          db.prepare('DELETE FROM club_sessions WHERE club=?').run(b.club);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return json(res, 200, { ok: true }), true;
      }
      throw new InputError('Endpoint not found.', 404);
    }
    if (path === '/api/club/login' && req.method === 'POST') {
      rate(req, 'club-login', 30, 15 * 60 * 1000);
      const b = await body(req), password = b.password;
      if (typeof password !== 'string' || !password || password.length > 128) throw new InputError('Enter your club password.');
      const account = db.prepare('SELECT * FROM club_accounts WHERE club=?').get(typeof b.club === 'string' ? b.club : '');
      const digest = await derive(password, account?.salt || 'sjl-unconfigured-club', 64);
      if (!account?.enabled || !account.passwordHash || !timingSafeEqual(digest, Buffer.from(account.passwordHash, 'hex'))) throw new InputError('Club or password is incorrect, or access is not enabled.', 401);
      // Credential reset/disable may have happened during asynchronous hashing.
      const current = db.prepare('SELECT version,enabled FROM club_accounts WHERE club=?').get(account.club);
      if (!current?.enabled || current.version !== account.version) throw new InputError('Club access changed. Try signing in again.', 401);
      db.prepare('DELETE FROM club_sessions WHERE tokenHash=? OR expires<=?').run(tokenKey(req), Date.now());
      if (db.prepare('SELECT COUNT(*) n FROM club_sessions WHERE club=?').get(account.club).n >= 100) throw new InputError('Too many club sessions. Contact the league administrator.', 429);
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO club_sessions VALUES(?,?,?)').run(hash(token), account.club, Date.now() + lifetime);
      setCookie(res, token);
      return json(res, 200, { ok: true, club: account.club }), true;
    }
    if (path === '/api/club/session' && req.method === 'GET') {
      const account = requireClub(req);
      return json(res, 200, { ok: true, role: 'club', club: account.club, coachTools: account.club === 'Prairie Sky FC' }), true;
    }
    if (path === '/api/club/logout' && req.method === 'POST') {
      db.prepare('DELETE FROM club_sessions WHERE tokenHash=?').run(tokenKey(req));
      setCookie(res, '', 0);
      return json(res, 200, { ok: true }), true;
    }
    return false;
  }
  return { handle, requireClub };
}
