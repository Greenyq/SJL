import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
let dir,child,base,admin,ref,other,home,away,detail;
const password=randomBytes(24).toString('hex'),match='2026-11-15-1',endpoint='/api/referee/matches/'+match;
async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir,ADMIN_PASSWORD:password,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});let output='',errors='';child.stderr.on('data',d=>errors+=d);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'Startup timed out')),10000);child.stdout.on('data',d=>{output+=d;const m=output.match(/port (\d+)/);if(m){clearTimeout(timer);base='http://127.0.0.1:'+m[1];resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});});}
async function stop(){if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
async function api(path,method='GET',payload,cookie){const r=await fetch(base+path,{method,headers:{...(payload?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:payload?JSON.stringify(payload):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const payload=()=>({version:detail.protocol?.version||0,status:'draft',homeScore:2,awayScore:1,notes:'Referee test',players:detail.players.map(p=>({id:p.id,playerVersion:p.version,reportVersion:p.reportVersion,goals:p.id===home.id?2:1,assists:p.id===home.id?1:0,yellow:p.id===home.id?2:0,red:p.id===home.id?1:0}))});
before(async()=>{dir=await mkdtemp(join(tmpdir(),'sjl-referee-'));await start();admin=(await api('/api/admin/login','POST',{password})).cookie;
  for(const username of ['ref.one','ref.two'])assert.equal((await api('/api/admin/referees','PUT',{username,name:username,password,version:0,enabled:true},admin)).status,200);
  ref=(await api('/api/referee/login','POST',{username:'ref.one',password})).cookie;other=(await api('/api/referee/login','POST',{username:'ref.two',password})).cookie;
  const add=async(club,name)=>(await api('/api/admin/players','POST',{club,name,ageGroup:'U10',goals:4,assists:2,cleanSheets:0},admin)).data.player;
  home=await add('Prairie Sky FC','Home referee player');away=await add('Dynamo Soccer Club','Away referee player');detail=(await api(endpoint,'GET',undefined,ref)).data;
});
after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
test('referee authentication grants protocols without admin, club, or private registration access',async()=>{
 assert.equal((await api(endpoint)).status,401);assert.equal((await api('/api/admin/referees','GET',undefined,ref)).status,401);assert.equal((await api('/api/admin/players','GET',undefined,ref)).status,401);assert.equal((await api('/api/club/players','GET',undefined,ref)).status,401);assert.equal((await api('/api/referee/login','POST',{username:'ref.one',password:'wrong'})).status,401);
 assert.equal((await api('/api/referee/session','GET',undefined,ref)).data.username,'ref.one');assert.equal((await api(endpoint,'GET',undefined,ref)).data.players.length,2);assert.equal(detail.players[0].contactEmail,undefined);
});
test('atomic saves validate roster, cards, assist counts and preserve all totals on errors',async()=>{
 for(const edit of [p=>p.players.pop(),p=>p.players[0].yellow=3,p=>p.players[0].red=2,p=>p.homeScore=1,p=>p.players.find(r=>r.id===home.id).assists=3,p=>p.players.push(p.players[0])]){const b=payload();edit(b);assert.ok([400,409].includes((await api(endpoint,'PUT',b,ref)).status));assert.equal((await api(endpoint,'GET',undefined,ref)).data.protocol,null);}
 const r=await api(endpoint,'PUT',payload(),ref);assert.equal(r.status,200);detail=r.data;assert.equal(detail.players.find(p=>p.id===home.id).goals,6);assert.equal(detail.players.find(p=>p.id===away.id).goals,5);assert.equal(detail.players.find(p=>p.id===home.id).yellow,2);assert.equal(detail.protocol.updatedBy,'ref.one');
});
test('repeated saves apply no double counting, detect stale editors and block legacy edits',async()=>{
 const stale=payload();let r=await api(endpoint,'PUT',payload(),other);assert.equal(r.status,200);detail=r.data;assert.equal(detail.players.find(p=>p.id===home.id).goals,6);assert.equal((await api(endpoint,'PUT',stale,ref)).status,409);
 assert.equal((await api('/api/admin/match-stats/'+match+'/players/'+home.id,'PUT',{goals:7,assists:0,version:detail.players.find(p=>p.id===home.id).reportVersion,playerVersion:detail.players.find(p=>p.id===home.id).version},admin)).status,409);
});
test('final scores feed public fixtures; only administrator can correct or reopen a final record',async()=>{
 let r=await api(endpoint,'PUT',{...payload(),status:'final'},ref);assert.equal(r.status,200);detail=r.data;
 const fixture=(await api('/assets/schedule.json')).data.matches.find(m=>m.id===match);assert.equal(fixture.status,'final');assert.equal(fixture.homeScore,2);assert.equal(fixture.awayScore,1);
 assert.equal((await api(endpoint,'PUT',payload(),other)).status,403);
 r=await api(endpoint,'PUT',{...payload(),status:'final',homeScore:3},admin);assert.equal(r.status,200);detail=r.data;assert.equal(detail.protocol.updatedBy,'superadmin');assert.equal((await api('/assets/schedule.json')).data.matches.find(m=>m.id===match).homeScore,3);
 r=await api(endpoint,'PUT',payload(),admin);assert.equal(r.status,200);detail=r.data;assert.equal(detail.protocol.status,'draft');
});
test('corrections subtract old contributions while preserving unrelated season totals',async()=>{
 const b=payload();b.players.find(p=>p.id===home.id).goals=1;b.players.find(p=>p.id===home.id).yellow=0;b.players.find(p=>p.id===home.id).red=0;b.homeScore=1;const r=await api(endpoint,'PUT',b,ref);assert.equal(r.status,200);detail=r.data;const p=detail.players.find(p=>p.id===home.id);assert.equal(p.goals,5);assert.equal(p.assists,3);assert.equal(p.yellow,0);assert.equal(p.red,0);
});
test('protocols, cards and sessions survive restart; disabling or resetting accounts revokes sessions',async()=>{
 await stop();await start();const r=await api(endpoint,'GET',undefined,ref);assert.equal(r.status,200);assert.equal(r.data.protocol.version,detail.protocol.version);assert.equal(r.data.players.find(p=>p.id===home.id).goals,5);
 admin=(await api('/api/admin/login','POST',{password})).cookie;const a=(await api('/api/admin/referees','GET',undefined,admin)).data.accounts.find(a=>a.username==='ref.one');assert.equal(a.passwordHash,undefined);
 assert.equal((await api('/api/admin/referees','PUT',{...a,enabled:false},admin)).status,200);assert.equal((await api(endpoint,'GET',undefined,ref)).status,401);assert.equal((await api('/api/referee/login','POST',{username:a.username,password})).status,401);assert.equal((await api(endpoint,'GET',undefined,other)).status,200);
});
