import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const derive = promisify(scrypt), hash = v => createHash('sha256').update(v).digest('hex');
export function setupReferee({ db, root, InputError, json, text, integer, rate, body, cookieSecure, requireAdmin }) {
  const schedule = JSON.parse(readFileSync(join(root, 'assets/schedule.json'), 'utf8'));
  const aliases = { Dynamo:'Dynamo Soccer Club', YFC:'Youth Football Club', Birds:'Birds Academy', 'Green Strikers':'Green Strikers FC' };
  const canonical = n => aliases[n] || n;
  const sides = m => [canonical(m.home), canonical(m.away)];
  db.exec(`CREATE TABLE IF NOT EXISTS referee_accounts(username TEXT PRIMARY KEY, name TEXT NOT NULL, passwordHash TEXT NOT NULL, salt TEXT NOT NULL, enabled INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS referee_sessions(tokenHash TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS match_protocols(matchId TEXT PRIMARY KEY, status TEXT NOT NULL, homeScore INTEGER NOT NULL, awayScore INTEGER NOT NULL, notes TEXT NOT NULL, updatedBy TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS match_cards(matchId TEXT NOT NULL, playerId TEXT NOT NULL, yellow INTEGER NOT NULL, red INTEGER NOT NULL, PRIMARY KEY(matchId,playerId));
    CREATE TABLE IF NOT EXISTS protocol_audit(id INTEGER PRIMARY KEY, matchId TEXT NOT NULL, actor TEXT NOT NULL, savedAt TEXT NOT NULL, payload TEXT NOT NULL);`);
  const tokenKey = req => { const token = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('sjl_referee='))?.slice(12); return token ? hash(token) : ''; };
  const cookie = (res, token, age=28800) => res.setHeader('Set-Cookie', `sjl_referee=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${cookieSecure?'; Secure':''}`);
  function actor(req) {
    try { requireAdmin(req); return {username:'superadmin',name:'League administrator',admin:true}; } catch(e) { if(e.status!==401) throw e; }
    const a = db.prepare(`SELECT a.username,a.name FROM referee_sessions s JOIN referee_accounts a ON a.username=s.username WHERE s.tokenHash=? AND s.expires>? AND a.enabled=1`).get(tokenKey(req),Date.now());
    if(!a) throw new InputError('Sign in with your referee account.',401);
    return a;
  }
  const protocol = id => db.prepare('SELECT * FROM match_protocols WHERE matchId=?').get(id);
  function roster(m) {
    return db.prepare(`SELECT p.id,p.name,p.club,p.version,p.goals,p.assists FROM players p WHERE p.ageGroup=? AND p.club IN (?,?) AND NOT EXISTS(
      SELECT e.id FROM league_entries e JOIN league_teams t ON t.id=e.teamId WHERE e.statsPlayerId=p.id AND (e.status<>'approved' OR t.active<>1)) ORDER BY p.club,p.name COLLATE NOCASE`).all(m.ageGroup,...sides(m));
  }
  function detail(m) {
    const players=roster(m), stats=db.prepare('SELECT * FROM match_player_stats WHERE matchId=?').all(m.id), cards=db.prepare('SELECT * FROM match_cards WHERE matchId=?').all(m.id);
    return {match:m,clubs:sides(m),protocol:protocol(m.id)||null,players:players.map(p=>({...p,matchGoals:stats.find(r=>r.playerId===p.id)?.goals||0,matchAssists:stats.find(r=>r.playerId===p.id)?.assists||0,reportVersion:stats.find(r=>r.playerId===p.id)?.version||0,yellow:cards.find(r=>r.playerId===p.id)?.yellow||0,red:cards.find(r=>r.playerId===p.id)?.red||0}))};
  }
  function publicSchedule() {
    return {...schedule,matches:schedule.matches.map(m=>{const p=protocol(m.id);return p?.status==='final'?{...m,homeScore:p.homeScore,awayScore:p.awayScore,status:'final'}:m;})};
  }
  async function handle(req,res,path) {
    if(path.startsWith('/api/admin/referees')) {
      requireAdmin(req);
      if(path==='/api/admin/referees' && req.method==='GET') {json(res,200,{accounts:db.prepare('SELECT username,name,enabled,version FROM referee_accounts ORDER BY name').all()});return true;}
      if(path==='/api/admin/referees' && req.method==='PUT') {
        const b=await body(req), username=text(b.username,'Username',40).toLowerCase(), name=text(b.name,'Referee name',100);
        if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))throw new InputError('Use a username of 3–40 letters, numbers, dots, dashes or underscores.');
        if(username==='superadmin')throw new InputError('This username is reserved.');
        integer(b.version,'Account version',0,Number.MAX_SAFE_INTEGER);
        if(typeof b.enabled!=='boolean')throw new InputError('Choose whether access is enabled.');
        const current=db.prepare('SELECT * FROM referee_accounts WHERE username=?').get(username);
        let salt=current?.salt, digest=current?.passwordHash;
        if(b.password) {if(typeof b.password!=='string'||b.password.length<16||b.password.length>128)throw new InputError('Use a password of 16–128 characters.');salt=randomBytes(16).toString('hex');digest=(await derive(b.password,salt,64)).toString('hex');}
        if(!digest)throw new InputError('Set a password for this referee.');
        db.exec('BEGIN IMMEDIATE');
        try {
          const latest=db.prepare('SELECT version FROM referee_accounts WHERE username=?').get(username);
          if((latest?.version||0)!==b.version)throw new InputError('Account changed. Refresh before saving.',409);
          db.prepare(`INSERT INTO referee_accounts VALUES(?,?,?,?,?,1) ON CONFLICT(username) DO UPDATE SET name=excluded.name,passwordHash=excluded.passwordHash,salt=excluded.salt,enabled=excluded.enabled,version=referee_accounts.version+1`).run(username,name,digest,salt,Number(b.enabled));
          db.prepare('DELETE FROM referee_sessions WHERE username=?').run(username);db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        json(res,200,{ok:true});return true;
      }
      throw new InputError('Endpoint not found.',404);
    }
    if(!path.startsWith('/api/referee/'))return false;
    if(path==='/api/referee/login' && req.method==='POST') {
      rate(req,'referee-login',20,900000);const b=await body(req);
      const username=typeof b.username==='string'?b.username.trim().toLowerCase():'';
      if(typeof b.password!=='string'||!b.password||b.password.length>128)throw new InputError('Enter your referee password.');
      const a=db.prepare('SELECT * FROM referee_accounts WHERE username=?').get(username);
      const digest=await derive(b.password,a?.salt||'sjl-referee-unconfigured',64);
      if(!a?.enabled||!a.passwordHash||!timingSafeEqual(digest,Buffer.from(a.passwordHash,'hex')))throw new InputError('Username or password is incorrect, or access is disabled.',401);
      const current=db.prepare('SELECT enabled,version FROM referee_accounts WHERE username=?').get(username);
      if(!current?.enabled||current.version!==a.version)throw new InputError('Account changed. Sign in again.',401);
      db.prepare('DELETE FROM referee_sessions WHERE tokenHash=? OR expires<=?').run(tokenKey(req),Date.now());
      if(db.prepare('SELECT COUNT(*) n FROM referee_sessions WHERE username=?').get(username).n>=100)throw new InputError('Too many active sessions.',429);
      const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO referee_sessions VALUES(?,?,?)').run(hash(token),username,Date.now()+28800000);cookie(res,token);json(res,200,{ok:true});return true;
    }
    if(path==='/api/referee/logout' && req.method==='POST') {db.prepare('DELETE FROM referee_sessions WHERE tokenHash=?').run(tokenKey(req));cookie(res,'',0);json(res,200,{ok:true});return true;}
    const user=actor(req);
    if(path==='/api/referee/session' && req.method==='GET'){json(res,200,{...user,role:user.admin?'superadmin':'referee'});return true;}
    if(path==='/api/referee/matches' && req.method==='GET'){json(res,200,{matches:schedule.matches.map(m=>({...m,protocol:protocol(m.id)||null}))});return true;}
    const route=path.match(/^\/api\/referee\/matches\/([^/]+)$/),m=route&&schedule.matches.find(m=>m.id===route[1]);
    if(!m)throw new InputError('Match not found.',404);
    if(req.method==='GET'){json(res,200,detail(m));return true;}
    if(req.method!=='PUT')throw new InputError('Method not allowed.',405);
    const b=await body(req);integer(b.version,'Protocol version',0,Number.MAX_SAFE_INTEGER);
    if(!['draft','final'].includes(b.status))throw new InputError('Choose draft or final.');
    integer(b.homeScore,'Home score',0,100);integer(b.awayScore,'Away score',0,100);
    const notes=text(b.notes??'','Match notes',2000,false);
    if(!Array.isArray(b.players)||b.players.length>150)throw new InputError('Invalid match roster.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous=protocol(m.id);
      if((previous?.version||0)!==b.version)throw new InputError('Protocol changed. Reload the match before saving.',409);
      if(previous?.status==='final'&&!user.admin)throw new InputError('This protocol is final. Ask the league administrator to correct or reopen it.',403);
      const players=roster(m), ids=new Set(b.players.map(p=>p.id));
      if(ids.size!==b.players.length||players.length!==ids.size||players.some(p=>!ids.has(p.id)))throw new InputError('Roster changed. Reload the match before saving.',409);
      // Prevent silently losing previously recorded contributions after a transfer or archival.
      const oldRows=db.prepare('SELECT * FROM match_player_stats WHERE matchId=?').all(m.id);
      if(oldRows.some(r=>!ids.has(r.playerId)&&(r.goals||r.assists)) || db.prepare('SELECT * FROM match_cards WHERE matchId=?').all(m.id).some(r=>!ids.has(r.playerId)&&(r.yellow||r.red)))throw new InputError('A recorded player left this roster. Ask the league administrator to restore the player before correcting the protocol.',409);
      const sums=new Map(sides(m).map(c=>[c,{goals:0,assists:0}]));
      for(const row of b.players) {
        for(const key of ['goals','assists'])integer(row[key],key,0,100);
        integer(row.yellow,'Yellow cards',0,2);integer(row.red,'Red cards',0,1);
        integer(row.playerVersion,'Player version',1,Number.MAX_SAFE_INTEGER);integer(row.reportVersion,'Statistics version',0,Number.MAX_SAFE_INTEGER);
        const p=players.find(p=>p.id===row.id),old=oldRows.find(r=>r.playerId===p.id);
        if(p.version!==row.playerVersion||(old?.version||0)!==row.reportVersion||(old&&old.club!==p.club))throw new InputError('Player statistics changed. Reload the match before saving.',409);
        const totals=sums.get(p.club);totals.goals+=row.goals;totals.assists+=row.assists;
        const goals=p.goals+row.goals-(old?.goals||0),assists=p.assists+row.assists-(old?.assists||0);
        if(goals<0||assists<0||goals>10000||assists>10000)throw new InputError('Season totals conflict with this correction. Ask the administrator to reconcile the totals.',409);
        if(row.goals!==(old?.goals||0)||row.assists!==(old?.assists||0)) {
          db.prepare('UPDATE players SET goals=?,assists=?,version=version+1 WHERE id=?').run(goals,assists,p.id);
          db.prepare(`INSERT INTO match_player_stats VALUES(?,?,?,?,?,1,?) ON CONFLICT(matchId,playerId) DO UPDATE SET goals=excluded.goals,assists=excluded.assists,version=match_player_stats.version+1,updatedAt=excluded.updatedAt`).run(m.id,p.id,p.club,row.goals,row.assists,new Date().toISOString());
        }
        db.prepare(`INSERT INTO match_cards VALUES(?,?,?,?) ON CONFLICT(matchId,playerId) DO UPDATE SET yellow=excluded.yellow,red=excluded.red`).run(m.id,p.id,row.yellow,row.red);
      }
      for(const [index,c] of sides(m).entries()) {const score=index?b.awayScore:b.homeScore,t=sums.get(c);if(t.goals>score||t.assists>t.goals)throw new InputError('Recorded player goals cannot exceed the team score, and assists cannot exceed recorded goals.');}
      const now=new Date().toISOString();
      db.prepare(`INSERT INTO match_protocols VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(matchId) DO UPDATE SET status=excluded.status,homeScore=excluded.homeScore,awayScore=excluded.awayScore,notes=excluded.notes,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt,version=match_protocols.version+1`).run(m.id,b.status,b.homeScore,b.awayScore,notes,user.username,now);
      db.prepare('INSERT INTO protocol_audit(matchId,actor,savedAt,payload) VALUES(?,?,?,?)').run(m.id,user.username,now,JSON.stringify(b));db.exec('COMMIT');
      json(res,200,detail(m));return true;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  return {handle,publicSchedule};
}
