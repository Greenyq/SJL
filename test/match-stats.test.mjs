import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

let dir, child, base, admin, prairie, dynamo, player, foreign, report;
const password=randomBytes(24).toString('hex'), matchId='2026-11-15-1';
async function start(){
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir,ADMIN_PASSWORD:password,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stderr.on('data',d=>errors+=d);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'Startup timed out')),5000);child.stdout.on('data',d=>{output+=d;const m=output.match(/port (\d+)/);if(m){clearTimeout(timer);base='http://127.0.0.1:'+m[1];resolve()}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors))})});
}
async function stop(){if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit')}}
async function api(path,method='GET',payload,cookie){
 const r=await fetch(base+path,{method,headers:{...(payload?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:payload?JSON.stringify(payload):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'sjl-match-'));await start();admin=(await api('/api/admin/login','POST',{password})).cookie;
 for(const club of ['Prairie Sky FC','Dynamo Soccer Club']){
  const account=(await api('/api/admin/club-accounts','GET',undefined,admin)).data.accounts.find(a=>a.club===club);
  assert.equal((await api('/api/admin/club-accounts/password','PUT',{club,password,enabled:true,version:account.version},admin)).status,200);
 }
 prairie=(await api('/api/club/login','POST',{club:'Prairie Sky FC',password})).cookie;
 dynamo=(await api('/api/club/login','POST',{club:'Dynamo Soccer Club',password})).cookie;
 const add=async(club,name)=>(await api('/api/admin/players','POST',{club,name,ageGroup:'U10',goals:4,assists:2,cleanSheets:0},admin)).data.player;
 player=await add('Prairie Sky FC','Own player');foreign=await add('Dynamo Soccer Club','Opponent player');
});
after(async()=>{await stop();await rm(dir,{recursive:true,force:true})});
const endpoint=id=>'/api/club/match-stats/'+matchId+'/players/'+id;
const stats=(p,goals,assists,version=0)=>({goals,assists,version,playerVersion:p.version});
test('match reports require authentication and isolate clubs even when they share a fixture',async()=>{
 assert.equal((await api('/api/club/match-stats')).status,401);
 assert.equal((await api('/api/admin/match-stats','GET',undefined,prairie)).status,401);
 const list=(await api('/api/club/match-stats','GET',undefined,prairie)).data.matches;
 assert.ok(list.every(m=>[m.home,m.away].includes('Prairie Sky FC')));
 const detail=await api('/api/club/match-stats/'+matchId,'GET',undefined,prairie);
 assert.equal(detail.status,200);assert.deepEqual(detail.data.players.map(p=>p.id),[player.id]);
 assert.equal((await api('/api/club/match-stats/'+matchId+'?club=Dynamo%20Soccer%20Club','GET',undefined,prairie)).status,403);
 assert.equal((await api('/api/club/match-stats/2026-11-01-2','GET',undefined,prairie)).status,404);
 assert.equal((await api(endpoint(foreign.id),'PUT',stats(foreign,2,1),prairie)).status,404);
 assert.equal((await api('/api/club/match-stats/2026-11-01-2/players/'+player.id,'PUT',stats(player,2,1),prairie)).status,404);
 assert.equal((await api(endpoint(player.id),'PUT',stats(player,-1,1),prairie)).status,400);
});
test('saving, repeating and correcting a report apply deltas and retain unrelated season totals',async()=>{
 let r=await api(endpoint(player.id),'PUT',stats(player,2,1),prairie);assert.equal(r.status,200);assert.equal(r.data.player.goals,6);assert.equal(r.data.player.assists,3);player=r.data.player;report=r.data.report;
 assert.equal((await api(endpoint(player.id),'PUT',stats(player,2,1,0),prairie)).status,409);
 r=await api(endpoint(player.id),'PUT',stats(player,2,1,report.version),prairie);assert.equal(r.status,200);assert.equal(r.data.player.goals,6);player=r.data.player;report=r.data.report;
 r=await api(endpoint(player.id),'PUT',stats(player,1,0,report.version),prairie);assert.equal(r.status,200);assert.equal(r.data.player.goals,5);assert.equal(r.data.player.assists,2);player=r.data.player;report=r.data.report;
 const other=(await api('/api/club/match-stats/'+matchId,'GET',undefined,dynamo)).data;assert.deepEqual(other.reports,[]);assert.deepEqual(other.players.map(p=>p.id),[foreign.id]);
 const publicData=(await api('/api/stats')).data;assert.equal(publicData.players.find(p=>p.id===player.id).goals,5);assert.equal(publicData.reports,undefined);
});
test('concurrent season edits are detected and administrator can correct either team',async()=>{
 const old={...player};let r=await api('/api/admin/players/'+player.id,'PUT',{...player,assists:8},admin);assert.equal(r.status,200);player=r.data.player;
 assert.equal((await api(endpoint(player.id),'PUT',stats(old,4,4,report.version),prairie)).status,409);
 r=await api('/api/admin/match-stats/'+matchId+'/players/'+player.id,'PUT',stats(player,0,0,report.version),admin);assert.equal(r.status,200);assert.equal(r.data.player.goals,4);assert.equal(r.data.player.assists,8);player=r.data.player;report=r.data.report;
 r=await api('/api/admin/match-stats/'+matchId+'/players/'+foreign.id,'PUT',stats(foreign,3,1),admin);assert.equal(r.status,200);assert.equal(r.data.player.goals,7);
});
test('reports and totals survive restart and clubs cannot access the other report',async()=>{
 await stop();await start();const r=await api('/api/club/match-stats/'+matchId,'GET',undefined,prairie);assert.equal(r.status,200);assert.equal(r.data.reports.length,1);assert.equal(r.data.reports[0].version,report.version);assert.equal(r.data.players[0].assists,8);
 const other=await api('/api/club/match-stats/'+matchId,'GET',undefined,dynamo);assert.equal(other.data.reports[0].goals,3);assert.equal(other.data.players[0].goals,7);
});
