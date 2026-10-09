import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupClubMail } from './club-mail.mjs';
const derive=promisify(scrypt),hash=value=>createHash('sha256').update(value).digest('hex');
const lifetime=7*24*60*60*1000;
export function setupLeague({db,root,clubs,InputError,json,text,integer,email,rate,body,cookieSecure}){
 const policies=JSON.parse(readFileSync(join(root,'assets/league-policies.json'),'utf8'));
 const policiesHash=hash(JSON.stringify(policies));
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS parent_accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,passwordHash TEXT NOT NULL,salt TEXT NOT NULL,recoveryHash TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS parent_sessions(tokenHash TEXT PRIMARY KEY,parentId TEXT NOT NULL REFERENCES parent_accounts(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS league_teams(id TEXT PRIMARY KEY,club TEXT NOT NULL,ageGroup TEXT NOT NULL,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(club,ageGroup,name));
 CREATE TABLE IF NOT EXISTS league_entries(id TEXT PRIMARY KEY,parentId TEXT NOT NULL REFERENCES parent_accounts(id),firstName TEXT NOT NULL,lastName TEXT NOT NULL,birthYear INTEGER NOT NULL,teamId TEXT NOT NULL REFERENCES league_teams(id),status TEXT NOT NULL DEFAULT 'pending',statsPlayerId TEXT UNIQUE REFERENCES players(id),consent TEXT NOT NULL,signedBy TEXT NOT NULL,signedAt TEXT NOT NULL,policyVersion TEXT NOT NULL,policyHash TEXT NOT NULL,reviewNote TEXT NOT NULL DEFAULT '',reviewedAt TEXT);
 CREATE TABLE IF NOT EXISTS league_consent_events(id TEXT PRIMARY KEY,entryId TEXT NOT NULL REFERENCES league_entries(id),parentId TEXT NOT NULL REFERENCES parent_accounts(id),consent TEXT NOT NULL,createdAt TEXT NOT NULL,policyVersion TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS league_policy_versions(version TEXT PRIMARY KEY,hash TEXT NOT NULL,payload TEXT NOT NULL);`);
 db.prepare('INSERT OR IGNORE INTO league_policy_versions VALUES(?,?,?)').run(policies.version,policiesHash,JSON.stringify(policies));
 if(!db.prepare("SELECT value FROM meta WHERE key='leagueTeamsSeeded'").get()){
  const aliases={'Dynamo':'Dynamo Soccer Club','Birds':'Birds Academy','Green Strikers':'Green Strikers FC','YFC':'Youth Football Club'};
  const schedule=JSON.parse(readFileSync(join(root,'assets/schedule.json'),'utf8'));
  const insert=db.prepare('INSERT OR IGNORE INTO league_teams(id,club,ageGroup,name) VALUES(?,?,?,?)');
  for(const m of schedule.matches)for(const name of [m.home,m.away]){const club=aliases[name]||name;insert.run(club.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+m.ageGroup.toLowerCase(),club,m.ageGroup,club+' '+m.ageGroup)}
  db.prepare('INSERT INTO meta VALUES(?,?)').run('leagueTeamsSeeded','1');
 }
 const aliases={'Dynamo':'Dynamo Soccer Club','Birds':'Birds Academy','Green Strikers':'Green Strikers FC','YFC':'Youth Football Club'};
 const schedule=JSON.parse(readFileSync(join(root,'assets/schedule.json'),'utf8'));
 const canonical=name=>aliases[name]||name;
 const columns=db.prepare('PRAGMA table_info(league_entries)').all().map(c=>c.name);
 if(!columns.includes('contactPhone'))db.exec("ALTER TABLE league_entries ADD COLUMN contactPhone TEXT NOT NULL DEFAULT '';");
 if(!columns.includes('clubContactConsent'))db.exec('ALTER TABLE league_entries ADD COLUMN clubContactConsent INTEGER NOT NULL DEFAULT 0;');
 const mail=setupClubMail({db,clubs,InputError,email});
 const teams=()=>db.prepare('SELECT * FROM league_teams WHERE active=1 ORDER BY club,name').all();
 function parent(req){const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('sjl_parent='))?.slice(11);if(!token)return null;return db.prepare('SELECT a.id,a.email,a.name,s.tokenHash FROM parent_sessions s JOIN parent_accounts a ON a.id=s.parentId WHERE s.tokenHash=? AND s.expires>?').get(hash(token),Date.now())||null}
 function requireParent(req){const account=parent(req);if(!account)throw new InputError('Sign in to your parent account.',401);return account}
 function cookie(res,token,maxAge=lifetime/1000){res.setHeader('Set-Cookie',`sjl_parent=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${cookieSecure?'; Secure':''}`)}
 function issue(req,res,account){const old=parent(req);if(old)db.prepare('DELETE FROM parent_sessions WHERE tokenHash=?').run(old.tokenHash);db.prepare('DELETE FROM parent_sessions WHERE expires<?').run(Date.now());const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO parent_sessions VALUES(?,?,?)').run(hash(token),account.id,Date.now()+lifetime);cookie(res,token)}
 function credentials(b){const address=email(b.email).toLowerCase();if(!address)throw new InputError('Parent email is required.');const password=b.password;if(typeof password!=='string'||password.length>128||password.length<12)throw new InputError('Use a password of at least 12 characters.');return{address,password}}
 function choices(b){for(const key of ['media','interviews','publicStats'])if(typeof b[key]!=='boolean')throw new InputError('Choose each media and statistics permission.');return{media:b.media,interviews:b.interviews,publicStats:b.publicStats}}
 function getTeam(id){const team=db.prepare('SELECT * FROM league_teams WHERE id=? AND active=1').get(id);if(!team)throw new InputError('Choose an available league team.');return team}
 function profile(e){const team=db.prepare('SELECT * FROM league_teams WHERE id=?').get(e.teamId);const stats=e.statsPlayerId?db.prepare('SELECT * FROM players WHERE id=?').get(e.statsPlayerId):null;const matches=schedule.matches.filter(m=>m.ageGroup===team.ageGroup&&(canonical(m.home)===team.club||canonical(m.away)===team.club));return{...e,consent:JSON.parse(e.consent),team,stats,schedule:{season:schedule.season,timezone:schedule.timezone,matches}}}
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}}
 async function handle(req,res,path,isAdmin){
  if(path==='/api/league/teams'&&req.method==='GET'){json(res,200,{teams:teams(),policyVersion:policies.version});return true}
  if(path==='/api/parent/signup'&&req.method==='POST'){
   rate(req,'parent-signup',20,60*60*1000);const b=await body(req),{address,password}=credentials(b);if(b.guardian!==true)throw new InputError('Confirm that you are a parent or legal guardian.');const name=text(b.name,'Guardian name');
   if(db.prepare('SELECT id FROM parent_accounts WHERE email=?').get(address))throw new InputError('Unable to create an account with this email. Try signing in or account recovery.',409);
   const salt=randomBytes(16).toString('hex'),digest=(await derive(password,salt,64)).toString('hex'),recoveryCode=randomBytes(24).toString('hex'),id=randomUUID();
   // Hashing is asynchronous; re-check uniqueness inside the transaction.
   transaction(()=>{if(db.prepare('SELECT id FROM parent_accounts WHERE email=?').get(address))throw new InputError('Unable to create an account with this email.',409);db.prepare('INSERT INTO parent_accounts VALUES(?,?,?,?,?,?,?)').run(id,address,name,digest,salt,hash(recoveryCode),new Date().toISOString())});issue(req,res,{id});json(res,201,{ok:true,recoveryCode,account:{id,name,email:address}});return true;
  }
  if(path==='/api/parent/login'&&req.method==='POST'){
   rate(req,'parent-login',50,15*60*1000);const b=await body(req),{address,password}=credentials(b),account=db.prepare('SELECT * FROM parent_accounts WHERE email=?').get(address);
   const digest=await derive(password,account?.salt||'sjl-unknown-account',64);if(!account||!timingSafeEqual(digest,Buffer.from(account.passwordHash,'hex')))throw new InputError('Email or password is incorrect.',401);
   issue(req,res,account);json(res,200,{ok:true,account:{id:account.id,name:account.name,email:account.email}});return true;
  }
  if(path==='/api/parent/recover'&&req.method==='POST'){
   rate(req,'parent-recovery',10,15*60*1000);const b=await body(req),{address,password}=credentials(b),code=text(b.recoveryCode,'Recovery code',128),account=db.prepare('SELECT * FROM parent_accounts WHERE email=?').get(address);
   if(!account||!timingSafeEqual(Buffer.from(hash(code),'hex'),Buffer.from(account.recoveryHash,'hex')))throw new InputError('Email or recovery code is incorrect.',401);
   const oldRecovery=account.recoveryHash,salt=randomBytes(16).toString('hex'),digest=(await derive(password,salt,64)).toString('hex'),recoveryCode=randomBytes(24).toString('hex');
   transaction(()=>{const result=db.prepare('UPDATE parent_accounts SET passwordHash=?,salt=?,recoveryHash=? WHERE id=? AND recoveryHash=?').run(digest,salt,hash(recoveryCode),account.id,oldRecovery);if(!result.changes)throw new InputError('Recovery code has already been used.',409);db.prepare('DELETE FROM parent_sessions WHERE parentId=?').run(account.id)});
   issue(req,res,account);json(res,200,{ok:true,recoveryCode});return true;
  }
  if(path.startsWith('/api/parent/')){
   const account=requireParent(req);
   if(path==='/api/parent/session'&&req.method==='GET'){json(res,200,{account:{id:account.id,name:account.name,email:account.email}});return true}
   if(path==='/api/parent/logout'&&req.method==='POST'){db.prepare('DELETE FROM parent_sessions WHERE tokenHash=?').run(account.tokenHash);cookie(res,'',0);json(res,200,{ok:true});return true}
   if(path==='/api/parent/players'&&req.method==='GET'){json(res,200,{players:db.prepare('SELECT * FROM league_entries WHERE parentId=? ORDER BY signedAt DESC').all(account.id).map(profile)});return true}
   if(path==='/api/parent/players'&&req.method==='POST'){
    rate(req,'league-register',30,60*60*1000);const b=await body(req);if(b.website)throw new InputError('Unable to submit registration.');
    if(b.policyVersion!==policies.version)throw new InputError('The documents have changed. Reload and review the current version.',409);
    if(b.rules!==true||b.discipline!==true||b.acknowledgement!==true||b.guardian!==true)throw new InputError('Review the regulations, discipline rules and participation acknowledgement, and confirm guardian authority.');
    const firstName=text(b.firstName,'First name',60),lastName=text(b.lastName,'Last name',60),birthYear=integer(b.birthYear,'Birth year',2008,2022),team=getTeam(text(b.teamId,'Team',150)),signedBy=text(b.signedBy,'Guardian signature'),consent={...choices(b),rules:true,discipline:true,acknowledgement:true,guardian:true};
    const contactPhone=text(b.contactPhone,'Parent phone',40);if(!/^[+()\d .-]{7,40}$/.test(contactPhone)||contactPhone.replace(/\D/g,'').length<7)throw new InputError('Enter a valid parent phone number.');if(b.clubContactConsent!==true)throw new InputError('Confirm sharing registration and contact details with your selected club.');
    const id=randomUUID(),signedAt=new Date().toISOString();transaction(()=>{
     if(db.prepare('SELECT id FROM league_entries WHERE parentId=? AND lower(firstName)=lower(?) AND lower(lastName)=lower(?) AND birthYear=?').get(account.id,firstName,lastName,birthYear))throw new InputError('This child already has a registration in your account. View their profile or contact the organizer to change teams.',409);
     db.prepare('INSERT INTO league_entries(id,parentId,firstName,lastName,birthYear,teamId,consent,signedBy,signedAt,policyVersion,policyHash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,account.id,firstName,lastName,birthYear,team.id,JSON.stringify(consent),signedBy,signedAt,policies.version,policiesHash);
     db.prepare('INSERT INTO league_consent_events VALUES(?,?,?,?,?,?)').run(randomUUID(),id,account.id,JSON.stringify(consent),signedAt,policies.version);
     db.prepare('UPDATE league_entries SET contactPhone=?,clubContactConsent=1 WHERE id=?').run(contactPhone,id);
     mail.enqueue({id,firstName,lastName,birthYear,team,account,contactPhone,consent,signedAt});
    });void mail.flush().catch(()=>console.error('Club email queue could not be processed.'));json(res,201,{player:profile(db.prepare('SELECT * FROM league_entries WHERE id=?').get(id))});return true;
   }
   if(/^\/api\/parent\/players\/[^/]+\/consent$/.test(path)&&req.method==='PUT'){
    const id=path.split('/')[4],entry=db.prepare('SELECT * FROM league_entries WHERE id=? AND parentId=?').get(id,account.id);if(!entry)throw new InputError('Player not found.',404);
    const b=await body(req);if(b.policyVersion!==policies.version)throw new InputError('Reload to review the current consent terms.',409);const consent={...JSON.parse(entry.consent),...choices(b)},now=new Date().toISOString();transaction(()=>{db.prepare('UPDATE league_entries SET consent=? WHERE id=?').run(JSON.stringify(consent),id);db.prepare('INSERT INTO league_consent_events VALUES(?,?,?,?,?,?)').run(randomUUID(),id,account.id,JSON.stringify(consent),now,policies.version)});json(res,200,{ok:true});return true;
   }
  }
  if(path.startsWith('/api/admin/league-')){
   isAdmin(req);
   if(path==='/api/admin/league-mail'&&req.method==='GET'){json(res,200,mail.overview());return true}
   if(path==='/api/admin/league-mail/contact'&&req.method==='PUT'){const b=await body(req);mail.updateContact(b.club,b.email);json(res,200,{ok:true});return true}
   if(path==='/api/admin/league-mail/retry'&&req.method==='POST'){const b=await body(req);mail.retry(text(b.id,'Notification ID'));void mail.flush().catch(()=>console.error('Club email queue could not be processed.'));json(res,200,{ok:true});return true}
   if(path==='/api/admin/league-teams'&&req.method==='GET'){json(res,200,{teams:teams()});return true}
   if(path==='/api/admin/league-teams'&&req.method==='POST'){
    const b=await body(req);if(!clubs.includes(b.club)||!['U10','U13'].includes(b.ageGroup))throw new InputError('Choose a league club and age group.');const name=text(b.name,'Team name');if(db.prepare('SELECT id FROM league_teams WHERE club=? AND ageGroup=? AND name=?').get(b.club,b.ageGroup,name))throw new InputError('This team already exists.',409);const id=randomUUID();db.prepare('INSERT INTO league_teams(id,club,ageGroup,name) VALUES(?,?,?,?)').run(id,b.club,b.ageGroup,name);json(res,201,{ok:true});return true;
   }
   if(path==='/api/admin/league-entries'&&req.method==='GET'){
    json(res,200,{entries:db.prepare('SELECT * FROM league_entries ORDER BY signedAt DESC').all().map(e=>({...profile(e),notification:mail.forEntry(e.id),parentNotification:mail.forEntry(e.id,'parent'),parent:db.prepare('SELECT name,email FROM parent_accounts WHERE id=?').get(e.parentId),consentHistory:db.prepare('SELECT consent,createdAt,policyVersion FROM league_consent_events WHERE entryId=? ORDER BY createdAt').all(e.id).map(v=>({...v,consent:JSON.parse(v.consent)}))}))});return true;
   }
   if(/^\/api\/admin\/league-entries\/[^/]+\/review$/.test(path)&&req.method==='POST'){
    const id=path.split('/')[4],b=await body(req),entry=db.prepare('SELECT * FROM league_entries WHERE id=?').get(id);if(!entry)throw new InputError('Registration not found.',404);if(entry.status!=='pending')throw new InputError('This registration has already been reviewed. Refresh the list.',409);
    if(b.status==='approved'&&b.verified!==true)throw new InputError('Confirm guardian identity and club roster before approval.');
    if(!['approved','rejected'].includes(b.status))throw new InputError('Choose approve or decline.');const note=text(b.note??'','Review note',1000,false),team=getTeam(entry.teamId);let statsId=null;
    transaction(()=>{
     if(b.status==='approved'){
      const name=entry.firstName+' '+entry.lastName;
      if(b.statsPlayerId){const stats=db.prepare('SELECT * FROM players WHERE id=?').get(text(b.statsPlayerId,'Statistics player ID'));if(!stats||stats.club!==team.club||stats.ageGroup!==team.ageGroup||stats.name.toLowerCase()!==name.toLowerCase())throw new InputError('The selected statistics record must match the registered name, club and age group.');if(db.prepare('SELECT id FROM league_entries WHERE statsPlayerId=?').get(stats.id))throw new InputError('This statistics record is already linked to another profile.',409);statsId=stats.id}
      else{if(db.prepare('SELECT id FROM players WHERE lower(name)=lower(?) AND club=? AND ageGroup=?').get(name,team.club,team.ageGroup))throw new InputError('A matching statistics record exists. Select it explicitly after verifying the guardian and roster.',409);statsId=randomUUID();db.prepare('INSERT INTO players VALUES(?,?,?,?,?,?,?,1)').run(statsId,name,team.club,team.ageGroup,0,0,0)}
     }
     db.prepare('UPDATE league_entries SET status=?,statsPlayerId=?,reviewNote=?,reviewedAt=? WHERE id=?').run(b.status,statsId,note,new Date().toISOString(),id);
    });json(res,200,{ok:true});return true;
   }
  }
  return false;
 }
 function publicPlayers(rows){return rows.filter(p=>{const e=db.prepare('SELECT consent FROM league_entries WHERE statsPlayerId=?').get(p.id);return!e||JSON.parse(e.consent).publicStats===true})}
 function protectStatsIdentity(id,p){const entry=db.prepare('SELECT * FROM league_entries WHERE statsPlayerId=?').get(id);if(!entry)return;const team=db.prepare('SELECT * FROM league_teams WHERE id=?').get(entry.teamId);if(p.name!==entry.firstName+' '+entry.lastName||p.club!==team.club||p.ageGroup!==team.ageGroup)throw new InputError('This player is linked to a parent profile. Keep their registered name, club and age group; update only statistics.',409)}
 return{handle,publicPlayers,protectStatsIdentity};
}
