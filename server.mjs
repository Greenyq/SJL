import http from 'node:http';
import { setupLeague } from './league.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const clubs=['Prairie Sky FC','Dynamo Soccer Club','Youth Football Club','Birds Academy','Green Strikers FC','Shakhtar Academy Winnipeg'];
const dataDir=resolve(process.env.DATA_DIR||join(root,'.data'));
if(process.env.NODE_ENV==='production' && (!process.env.DATA_DIR || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length<16)){
  throw new Error('Production requires a persistent DATA_DIR and ADMIN_PASSWORD of at least 16 characters.');
}
mkdirSync(dataDir,{recursive:true,mode:0o700});
const db=new DatabaseSync(join(dataDir,'sjl.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,name TEXT NOT NULL,club TEXT NOT NULL,ageGroup TEXT NOT NULL,goals INTEGER NOT NULL,assists INTEGER NOT NULL,cleanSheets INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
if(!db.prepare("SELECT value FROM meta WHERE key='seeded'").get()){
 const seed=JSON.parse(readFileSync(join(root,'assets/player-stats.json'),'utf8'));
 const insert=db.prepare('INSERT INTO players VALUES(?,?,?,?,?,?,?,1)');
 db.exec('BEGIN');
 try{for(const p of seed.players||[])insert.run(randomUUID(),p.name,p.club,p.ageGroup,p.goals||0,p.assists||0,p.cleanSheets||0);db.prepare('INSERT INTO meta VALUES(?,?)').run('seeded','1');db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
}
const sessions=new Map(),limits=new Map();
const password=process.env.ADMIN_PASSWORD||'';
const salt=randomBytes(16),passwordHash=scryptSync(password,salt,64);
const cookieSecure=process.env.NODE_ENV==='production';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://img.youtube.com data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
class InputError extends Error { constructor(message,status=400){super(message);this.status=status} }
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function text(v,label,max=120,required=true){if(typeof v!=='string')throw new InputError(`${label} is required.`);v=v.trim();if((required&&!v)||v.length>max)throw new InputError(`${label} must be ${required?'1':'0'}–${max} characters.`);return v}
function integer(v,label,min,max){if(!Number.isInteger(v)||v<min||v>max)throw new InputError(`${label} must be a whole number between ${min} and ${max}.`);return v}
function email(v){v=text(v??'','Contact email',254,false);if(v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw new InputError('Enter a valid contact email.');return v}
function rate(req,bucket,count,windowMs){const key=bucket+':'+req.socket.remoteAddress;const now=Date.now();let entry=limits.get(key);if(!entry||entry.until<now){entry={count:0,until:now+windowMs};limits.set(key,entry)}if(++entry.count>count)throw new InputError('Too many attempts. Please try again later.',429)}
setInterval(()=>{const now=Date.now();for(const[k,v]of sessions)if(v.expires<now)sessions.delete(k);for(const[k,v]of limits)if(v.until<now)limits.delete(k)},60000).unref();
function session(req){const value=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('sjl_session='))?.slice(12);const key=value?createHash('sha256').update(value).digest('hex'):'';const s=sessions.get(key);if(!s||s.expires<Date.now()){sessions.delete(key);return null}return{key,...s}}
function requireAdmin(req){if(!session(req))throw new InputError('Sign in as administrator.',401)}
async function body(req){if(!req.headers['content-type']?.startsWith('application/json'))throw new InputError('JSON content is required.',415);let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw new InputError('Request is too large.',413);chunks.push(chunk)}try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value}catch{throw new InputError('Invalid JSON request.')}}
function validateStats(p){if(!clubs.includes(p.club))throw new InputError('Choose a league club.');if(!['U10','U13'].includes(p.ageGroup))throw new InputError('Choose U10 or U13.');return{name:text(p.name,'Player name'),club:p.club,ageGroup:p.ageGroup,goals:integer(p.goals,'Goals',0,10000),assists:integer(p.assists,'Assists',0,10000),cleanSheets:integer(p.cleanSheets,'Clean sheets',0,1000)}}
const allPlayers=()=>db.prepare('SELECT * FROM players ORDER BY name COLLATE NOCASE').all();
const league=setupLeague({db,root,clubs,InputError,json,text,integer,email,rate,body,cookieSecure});
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Content-Security-Policy',csp);
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(!['GET','HEAD'].includes(req.method)){
   const origin=req.headers.origin;
   if(origin){const host=req.headers.host;const allowed=process.env.PUBLIC_ORIGIN?new URL(process.env.PUBLIC_ORIGIN).origin:null;if(allowed?origin!==allowed:!['http://'+host,'https://'+host].includes(origin))throw new InputError('Request origin is not allowed.',403)}
  }
  if(path==='/health'&&req.method==='GET')return json(res,200,{ok:true});
  if(path==='/api/stats'&&req.method==='GET')return json(res,200,{season:'2026/27',players:league.publicPlayers(allPlayers())});
  if(await league.handle(req,res,path,requireAdmin))return;
  if(path==='/api/register'&&req.method==='POST'){
   rate(req,'register',15,60*60*1000);const b=await body(req);let payload;
   if(b.website)throw new InputError('Unable to submit registration.');
   if(b.kind==='club'){
    if(!Array.isArray(b.ageGroups)||b.ageGroups.length<1||b.ageGroups.length>12||!b.ageGroups.every(a=>/^U([5-9]|1[0-8])$/.test(a)))throw new InputError('Select at least one team age group.');
    payload={name:text(b.name,'Club name'),location:text(b.location,'Location',200),ageGroups:[...new Set(b.ageGroups)],contactEmail:email(b.contactEmail)};
   }else if(b.kind==='player'){
    if(b.preferredClub&&!clubs.includes(b.preferredClub))throw new InputError('Choose a league club or leave it blank.');
    payload={name:text(b.name,'Player name'),age:integer(b.age,'Age',4,18),experience:text(b.experience,'Experience',2000),preferredClub:b.preferredClub||'',contactEmail:email(b.contactEmail)};
   }else throw new InputError('Choose club or player registration.');
   const id=randomUUID();db.prepare('INSERT INTO registrations VALUES(?,?,?,?)').run(id,b.kind,JSON.stringify(payload),new Date().toISOString());return json(res,201,{ok:true,id});
  }
  if(path==='/api/admin/login'&&req.method==='POST'){
   rate(req,'login',10,15*60*1000);if(password.length<16)throw new InputError('Admin access has not been configured.',503);
   const b=await body(req);const supplied=text(b.password,'Password',256);
   if(!timingSafeEqual(scryptSync(supplied,salt,64),passwordHash))throw new InputError('Incorrect password.',401);
   const previous=session(req);if(previous)sessions.delete(previous.key);if(sessions.size>=100)throw new InputError('Too many active sessions. Please try later.',429);
   const token=randomBytes(32).toString('hex');sessions.set(createHash('sha256').update(token).digest('hex'),{expires:Date.now()+8*60*60*1000});
   res.setHeader('Set-Cookie',`sjl_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${cookieSecure?'; Secure':''}`);return json(res,200,{ok:true});
  }
  if(path.startsWith('/api/admin/')){
   requireAdmin(req);
   if(path==='/api/admin/session'&&req.method==='GET')return json(res,200,{ok:true});
   if(path==='/api/admin/logout'&&req.method==='POST'){const s=session(req);sessions.delete(s.key);res.setHeader('Set-Cookie',`sjl_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cookieSecure?'; Secure':''}`);return json(res,200,{ok:true})}
   if(path==='/api/admin/registrations'&&req.method==='GET')return json(res,200,{registrations:db.prepare('SELECT * FROM registrations ORDER BY createdAt DESC').all().map(r=>({...r,payload:JSON.parse(r.payload)}))});
   if(path==='/api/admin/players'&&req.method==='GET')return json(res,200,{players:allPlayers()});
   if(path==='/api/admin/players'&&req.method==='POST'){
    const b=await body(req),p=validateStats(b),id=randomUUID();
    if(db.prepare('SELECT id FROM players WHERE lower(name)=lower(?) AND club=? AND ageGroup=?').get(p.name,p.club,p.ageGroup))throw new InputError('This player already exists in this club and age group. Edit the existing record.',409);
    db.prepare('INSERT INTO players VALUES(?,?,?,?,?,?,?,1)').run(id,p.name,p.club,p.ageGroup,p.goals,p.assists,p.cleanSheets);return json(res,201,{player:db.prepare('SELECT * FROM players WHERE id=?').get(id)});
   }
   if(/^\/api\/admin\/players\/[^/]+$/.test(path)&&req.method==='PUT'){
    const id=path.split('/').at(-1),b=await body(req),p=validateStats(b);integer(b.version,'Version',1,Number.MAX_SAFE_INTEGER);league.protectStatsIdentity(id,p);
    if(db.prepare('SELECT id FROM players WHERE lower(name)=lower(?) AND club=? AND ageGroup=? AND id<>?').get(p.name,p.club,p.ageGroup,id))throw new InputError('This player already exists in this club and age group.',409);
    const result=db.prepare('UPDATE players SET name=?,club=?,ageGroup=?,goals=?,assists=?,cleanSheets=?,version=version+1 WHERE id=? AND version=?').run(p.name,p.club,p.ageGroup,p.goals,p.assists,p.cleanSheets,id,b.version);
    if(!result.changes)throw new InputError('This record changed or no longer exists. Reload it before saving.',409);return json(res,200,{player:db.prepare('SELECT * FROM players WHERE id=?').get(id)});
   }
  }
  if(path.startsWith('/api/'))throw new InputError('Endpoint not found.',404);
  if(!['GET','HEAD'].includes(req.method))throw new InputError('Method not allowed.',405);
  // Explicit public allowlist: never serve source, credentials or the database directory.
  let file;
  if(path==='/'||path==='/index.html')file=join(root,'index.html');
  else if(['/registration-player','/registration-player/','/league-register','/league-register/'].includes(path))file=join(root,'league-register.html');
  else if(path==='/parent'||path==='/parent/')file=join(root,'parent.html');
  else if(path==='/admin'||path==='/admin/'||path==='/admin.html')file=join(root,'admin.html');
  else if(/^\/assets\/[a-zA-Z0-9_-]+\.(jpg|png|svg|css|js|json)$/.test(path)&&path!=='/assets/player-stats.json')file=join(root,path);
  else throw new InputError('Page not found.',404);
  let bytes;try{if(!statSync(file).isFile())throw Error();bytes=readFileSync(file)}catch{throw new InputError('Page not found.',404)}
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=300'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch(e){if(!(e instanceof InputError))console.error('Request failed:',e.message);json(res,e.status||500,{error:e.status?e.message:'Unable to complete the request. Please try again.'})}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`SJL listening on port ${server.address().port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>{db.close();process.exit(0)});server.closeIdleConnections();setTimeout(()=>process.exit(1),10000).unref()});
