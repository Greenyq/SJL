import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { taskScore,defaultRules } from '../assets/coach-score.js';

let dir,child,base,admin,parent,prairie,dynamo,teams,own,other,ownStats,sessionId;
const adminPassword=randomBytes(24).toString('hex');
const clubPassword=randomBytes(24).toString('hex');
async function start(){
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir,ADMIN_PASSWORD:adminPassword,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stderr.on('data',d=>errors+=d);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup: '+errors)),5000);child.stdout.on('data',d=>{output+=d;const m=output.match(/port (\d+)/);if(m){clearTimeout(timer);base='http://127.0.0.1:'+m[1];resolve()}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors))})});
}
async function stop(){if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit')}}
async function api(path,method='GET',payload,cookie,headers={}){
  const response=await fetch(base+path,{method,headers:{...(payload?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:payload?JSON.stringify(payload):undefined});
  return {response,data:await response.json()};
}
function cookie(response){assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);return response.headers.get('set-cookie').split(';')[0]}
const login=async(club,password=clubPassword)=>cookie((await api('/api/club/login','POST',{club,password})).response);
async function configure(club,enabled=true,password=clubPassword){
  const account=(await api('/api/admin/club-accounts','GET',undefined,admin)).data.accounts.find(a=>a.club===club);
  return api('/api/admin/club-accounts/password','PUT',{club,enabled,password,version:account.version},admin);
}
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'sjl-club-'));await start();admin=cookie((await api('/api/admin/login','POST',{password:adminPassword})).response);
  const t=(await api('/api/league/teams')).data;teams=t.teams;
  const signup=await api('/api/parent/signup','POST',{email:'guardian@example.test',name:'Private Guardian',password:clubPassword,guardian:true});parent=signup.response.headers.get('set-cookie').split(';')[0];
  const add=async(club,firstName)=>{
    const team=teams.find(t=>t.club===club&&t.ageGroup==='U10');
    const r=await api('/api/parent/players','POST',{firstName,lastName:'Junior',birthYear:2016,teamId:team.id,policyVersion:t.policyVersion,rules:true,discipline:true,acknowledgement:true,guardian:true,signedBy:'Private Guardian',contactPhone:'2045550123',clubContactConsent:true,media:false,interviews:false,publicStats:false},parent);
    assert.equal(r.response.status,201);return r.data.player;
  };
  own=await add('Prairie Sky FC','Prairie');other=await add('Dynamo Soccer Club','Dynamo');
});
after(async()=>{await stop();await rm(dir,{recursive:true,force:true})});

test('scoring implements caps, both winger tasks and every forward mode',()=>{
  const s=(role,g,a,d,p,r=defaultRules)=>taskScore(role,{goals:g,assists:a,duels:d,passes:p},r);
  assert.equal(s('Forward',3,0,0,0).rating,10);assert.equal(s('Forward',2,1,0,0).rating,6.7);
  assert.equal(s('Forward',2,1,0,0,{...defaultRules,forwardMode:'Combined'}).rating,10);
  assert.equal(s('Forward',3,0,0,0,{...defaultRules,forwardMode:'Both'}).rating,5);
  assert.equal(s('Forward',9,0,0,0,{...defaultRules,forwardMode:'Both'}).rating,5);
  assert.equal(s('Winger',0,0,1,4).rating,7.5);assert.equal(s('Winger',0,0,8,0).rating,5);
  assert.equal(s('Defender',0,0,0,0).rating,0);assert.equal(s('Defender',0,0,3,0).rating,6);
  assert.equal(s('Goalkeeper',0,0,0,0).rating,null);
});
test('all six logins start disabled; only super admin can provision/reset credentials',async()=>{
  const accounts=(await api('/api/admin/club-accounts','GET',undefined,admin)).data.accounts;
  assert.equal(accounts.length,6);assert.ok(accounts.every(a=>!a.enabled));assert.doesNotMatch(JSON.stringify(accounts),/passwordHash|salt/);
  assert.equal((await api('/api/admin/club-accounts')).response.status,401);
  assert.equal((await api('/api/admin/club-accounts','GET',undefined,parent)).response.status,401);
  assert.equal((await api('/api/club/login','POST',{club:'Prairie Sky FC',password:clubPassword})).response.status,401);
  for(const a of accounts){assert.equal((await configure(a.club)).response.status,200);const c=await login(a.club);const session=(await api('/api/club/session','GET',undefined,c)).data;assert.equal(session.club,a.club);assert.equal(session.coachTools,a.club==='Prairie Sky FC');}
  prairie=await login('Prairie Sky FC');dynamo=await login('Dynamo Soccer Club');
  assert.equal((await api('/api/club/login','POST',{club:'Prairie Sky FC',password:'incorrect password'})).response.status,401);
  assert.equal((await api('/api/admin/club-accounts','GET',undefined,prairie)).response.status,401);
  assert.equal((await api('/api/admin/session','GET',undefined,prairie)).response.status,401);
  assert.equal((await api('/api/parent/players','GET',undefined,prairie)).response.status,401);
});
test('club APIs isolate teams, pending/approved rosters, contact details and edits by stored ownership',async()=>{
  const roster=(await api('/api/club/league-entries','GET',undefined,prairie)).data.entries;
  assert.deepEqual(roster.map(e=>e.id),[own.id]);assert.equal(roster[0].parent.email,'guardian@example.test');assert.equal(roster[0].signedBy,undefined);assert.equal(roster[0].parentId,undefined);assert.equal(roster[0].notification,undefined);
  assert.ok((await api('/api/club/league-teams','GET',undefined,prairie)).data.teams.every(t=>t.club==='Prairie Sky FC'));
  assert.deepEqual((await api('/api/club/league-entries?club=Dynamo','GET',undefined,prairie)).data.entries.map(e=>e.id),[own.id]);
  const edit={action:'rename',expectedName:'Dynamo Junior',expectedStatus:'pending',firstName:'Hacked',lastName:'Junior'};
  assert.equal((await api(`/api/club/league-entries/${other.id}/edit`,'POST',edit,prairie)).response.status,404);
  assert.equal((await api(`/api/club/league-entries/${other.id}/review`,'POST',{status:'approved',verified:true},prairie)).response.status,404);
  assert.equal((await api(`/api/club/league-entries/${own.id}/edit`,'POST',{action:'transfer',expectedName:'Prairie Junior',expectedStatus:'pending',expectedTeamId:own.team.id,teamId:other.team.id},prairie)).response.status,403);
  assert.equal((await api('/api/club/league-teams','POST',{club:'Dynamo Soccer Club',ageGroup:'U13',name:'Foreign team'},prairie)).response.status,403);
  for(const suffix of ['league-mail','league-mail/contact','league-mail/retry'])assert.equal((await api('/api/club/'+suffix,suffix==='league-mail'?'GET':suffix.endsWith('contact')?'PUT':'POST',suffix==='league-mail'?undefined:{},prairie)).response.status,403);
  assert.equal((await api(`/api/club/league-entries/${own.id}/review`,'POST',{status:'approved',verified:true},prairie)).response.status,200);
  assert.equal((await api(`/api/club/league-entries/${other.id}/review`,'POST',{status:'approved',verified:true},dynamo)).response.status,200);
  ownStats=(await api('/api/club/players','GET',undefined,prairie)).data.players[0];assert.equal(ownStats.name,'Prairie Junior');
  const foreign=(await api('/api/club/players','GET',undefined,dynamo)).data.players[0];
  assert.equal((await api(`/api/club/players/${foreign.id}`,'PUT',{...foreign,goals:10},prairie)).response.status,404);
  assert.equal((await api(`/api/club/players/${ownStats.id}`,'PUT',{...ownStats,club:'Dynamo Soccer Club'},prairie)).response.status,403);
  assert.equal((await api('/api/club/players','POST',{...ownStats,name:'Foreign',club:'Dynamo Soccer Club'},prairie)).response.status,403);
  assert.equal((await api(`/api/club/players/${ownStats.id}`,'PUT',{...ownStats,goals:4},prairie)).response.status,200);
  assert.equal((await api(`/api/club/players/${ownStats.id}`,'PUT',{...ownStats,goals:8},prairie)).response.status,409);
  assert.equal((await api('/api/admin/players','GET',undefined,admin)).data.players.length,2);
});
test('Prairie-only coach tool reuses actual roster, persists session-specific rules and never publishes evaluations',async()=>{
  assert.equal((await api('/api/club/coach/sessions','GET',undefined,dynamo)).response.status,403);
  assert.equal((await api('/api/admin/coach/sessions','GET',undefined,prairie)).response.status,401);
  assert.equal((await api('/api/club/coach/sessions')).response.status,401);
  const payload={date:'2026-10-25',label:'Private session',ageGroup:'U10',rules:defaultRules};
  assert.equal((await api('/api/club/coach/sessions','POST',{...payload,date:'2026-02-30'},prairie)).response.status,400);
  assert.equal((await api('/api/club/coach/sessions','POST',{...payload,rules:{...defaultRules,goals:0}},prairie)).response.status,400);
  assert.equal((await api('/api/club/coach/sessions','POST',payload,prairie,{Origin:'https://foreign.example'})).response.status,403);
  const made=await api('/api/club/coach/sessions','POST',payload,prairie);assert.equal(made.response.status,201);sessionId=made.data.session.id;
  const detail=(await api('/api/club/coach/sessions/'+sessionId,'GET',undefined,prairie)).data;assert.deepEqual(detail.players.map(p=>p.id),[own.id]);assert.equal(detail.players[0].name,'Prairie Junior');assert.deepEqual(detail.session.rules,defaultRules);
  const url=`/api/club/coach/sessions/${sessionId}/players/`;
  const observation={role:'Winger',stats:{goals:0,assists:0,duels:1,passes:4},notes:'Private development note',version:0};
  assert.equal((await api(url+other.id,'PUT',observation,prairie)).response.status,404);
  assert.equal((await api(url+own.id,'PUT',{...observation,stats:{...observation.stats,duels:-1}},prairie)).response.status,400);
  const saved=await api(url+own.id,'PUT',observation,prairie);assert.equal(saved.response.status,200);assert.equal(saved.data.observation.rating,7.5);
  assert.equal((await api(url+own.id,'PUT',observation,prairie)).response.status,409);
  const updated=await api(url+own.id,'PUT',{...observation,stats:{...observation.stats,duels:2},version:1},prairie);assert.equal(updated.data.observation.rating,10);
  assert.equal((await api('/api/admin/coach/sessions/'+sessionId,'GET',undefined,admin)).data.observations[0].rating,10);
  assert.equal((await api('/api/club/players','GET',undefined,prairie)).data.players[0].goals,4);
  for(const endpoint of ['/api/stats','/api/league/rosters','/api/parent/players'])assert.doesNotMatch(JSON.stringify((await api(endpoint,'GET',undefined,endpoint.startsWith('/api/parent')?parent:undefined)).data),/Private development note|Private session|completion|coach_observations/);
});
test('accounts/evaluations survive restart; password reset and disable revoke old sessions',async()=>{
  await stop();await start();assert.equal((await api('/api/club/session','GET',undefined,prairie)).response.status,200);
  const detail=(await api('/api/club/coach/sessions/'+sessionId,'GET',undefined,prairie)).data;assert.equal(detail.observations[0].rating,10);assert.equal(detail.observations[0].notes,'Private development note');
  admin=cookie((await api('/api/admin/login','POST',{password:adminPassword})).response);
  const old=(await api('/api/admin/club-accounts','GET',undefined,admin)).data.accounts.find(a=>a.club==='Prairie Sky FC');
  const rotated=' '+randomBytes(24).toString('hex')+' ';
  assert.equal((await configure('Prairie Sky FC',true,rotated)).response.status,200);
  assert.equal((await api('/api/club/session','GET',undefined,prairie)).response.status,401);
  assert.equal((await api('/api/club/login','POST',{club:'Prairie Sky FC',password:clubPassword})).response.status,401);
  prairie=await login('Prairie Sky FC',rotated);
  assert.equal((await api('/api/admin/club-accounts/password','PUT',{club:old.club,version:old.version,enabled:false},admin)).response.status,409);
  assert.equal((await configure('Prairie Sky FC',false,'')).response.status,200);
  assert.equal((await api('/api/club/session','GET',undefined,prairie)).response.status,401);
  assert.equal((await api('/api/club/login','POST',{club:'Prairie Sky FC',password:rotated})).response.status,401);
  assert.equal((await api('/api/club/session','GET',undefined,dynamo)).response.status,200);
  assert.equal((await api('/api/club/logout','POST',{},dynamo)).response.status,200);
  assert.equal((await api('/api/club/session','GET',undefined,dynamo)).response.status,401);
  const db=new DatabaseSync(join(dir,'sjl.sqlite'));const account=db.prepare('SELECT * FROM club_accounts WHERE club=?').get('Prairie Sky FC');assert.notEqual(account.passwordHash,rotated);assert.ok(account.salt);db.close();
});
