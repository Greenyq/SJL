import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

let child,base,dir,cookie,playerId,version;
const password=randomBytes(24).toString('hex');
async function start(){
 child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir,ADMIN_PASSWORD:password,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stderr.on('data',d=>errors+=d);await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server start timeout: '+errors)),5000);child.stdout.on('data',d=>{output+=d;const match=output.match(/SJL listening on port (\d+)/);if(match){base='http://127.0.0.1:'+match[1];clearTimeout(timeout);resolve()}});child.on('exit',()=>{clearTimeout(timeout);reject(Error('Server exited: '+errors))})});
}
async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit')}}
async function request(path,method='GET',data,authenticated=false,extraHeaders={}){
 const response=await fetch(base+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(authenticated?{Cookie:cookie}:{}),...extraHeaders},body:data?JSON.stringify(data):undefined});
 const value=await response.json();return{response,value};
}
async function login(){const{response}=await request('/api/admin/login','POST',{password});assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.match(response.headers.get('set-cookie'),/SameSite=Strict/)}
before(async()=>{dir=await mkdtemp(join(tmpdir(),'sjl-test-'));await start()});
after(async()=>{await stop();await rm(dir,{recursive:true,force:true})});
test('serves home/admin and exact imported schedule; keeps internal files private',async()=>{
 const home=await fetch(base+'/');assert.equal(home.status,200);const html=await home.text();assert.match(html,/REGISTER A CLUB/);assert.match(html,/REGISTER A LEAGUE PLAYER/);assert.match(html,/assets\/site.js/);assert.doesNotMatch(html,/NORTH STARS|LEAGUE TABLE/);
 assert.equal((await fetch(base+'/admin')).status,200);
 const schedule=await(await fetch(base+'/assets/schedule.json')).json();assert.equal(schedule.matches.length,42);assert.equal(new Set(schedule.matches.map(m=>m.date)).size,14);assert.equal(schedule.matches[0].date,'2026-10-25');assert.equal(schedule.matches.at(-1).date,'2027-01-31');assert.equal(schedule.matches.filter(m=>m.ageGroup==='U10').length,28);assert.equal(schedule.matches.filter(m=>m.ageGroup==='U13').length,14);assert.equal(schedule.matches.some(m=>m.home==='YFC'||m.away==='YFC'),false);
 for(const path of ['/server.mjs','/package.json','/.env','/.data/sjl.sqlite','/assets/player-stats.json','/assets/../server.mjs'])assert.equal((await fetch(base+path)).status,404,path);
});
test('rejects unauthorized admin access and cross-origin mutations',async()=>{
 assert.equal((await request('/api/admin/players')).response.status,401);
 assert.equal((await request('/api/admin/registrations')).response.status,401);
 assert.equal((await request('/api/admin/players','POST',{})).response.status,401);
 assert.equal((await request('/api/admin/login','POST',{password},false,{Origin:'https://other.example'})).response.status,403);
 assert.equal((await request('/api/admin/login','POST',{password:'wrong password'})).response.status,401);
 const wrongType=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'});assert.equal(wrongType.status,415);
});
test('validates registrations and stores multiple club ages and optional club preference',async()=>{
 const bad=await request('/api/register','POST',{kind:'club',name:'Example',location:'Winnipeg',ageGroups:[]});assert.equal(bad.response.status,400);
 const club=await request('/api/register','POST',{kind:'club',name:'Example FC',location:'South Winnipeg',ageGroups:['U10','U13','U10'],contactEmail:'club@example.com'});assert.equal(club.response.status,201);
 const player=await request('/api/register','POST',{kind:'player',name:'New Player',age:10,experience:'First season',preferredClub:'',contactEmail:''});assert.equal(player.response.status,201);
 const badAge=await request('/api/register','POST',{kind:'player',name:'New Player',age:10.5,experience:'First season'});assert.equal(badAge.response.status,400);
 const badClub=await request('/api/register','POST',{kind:'player',name:'New Player',age:10,experience:'First season',preferredClub:'Unknown'});assert.equal(badClub.response.status,400);
 await login();const admin=await request('/api/admin/registrations','GET',undefined,true);assert.equal(admin.value.registrations.length,2);assert.deepEqual(admin.value.registrations.find(r=>r.kind==='club').payload.ageGroups,['U10','U13']);
 const publicStats=await request('/api/stats');assert.equal(publicStats.value.registrations,undefined);assert.doesNotMatch(JSON.stringify(publicStats.value),/club@example.com|New Player/);
});
test('adds/updates real statistics, rejects duplicates and detects concurrent edits',async()=>{
 const stats={name:'League Player',club:'Prairie Sky FC',ageGroup:'U10',goals:2,assists:3,cleanSheets:0};
 const added=await request('/api/admin/players','POST',stats,true);assert.equal(added.response.status,201);playerId=added.value.player.id;version=added.value.player.version;
 const duplicate=await request('/api/admin/players','POST',{...stats,name:'league player'},true);assert.equal(duplicate.response.status,409);
 const negative=await request('/api/admin/players','PUT',{...stats,version,goals:-1},true);assert.equal(negative.response.status,404);
 const invalid=await request('/api/admin/players/'+playerId,'PUT',{...stats,version,goals:-1},true);assert.equal(invalid.response.status,400);
 const update=await request('/api/admin/players/'+playerId,'PUT',{...stats,version,goals:5},true);assert.equal(update.response.status,200);assert.equal(update.value.player.goals,5);assert.equal(update.value.player.version,2);
 const stale=await request('/api/admin/players/'+playerId,'PUT',{...stats,version,goals:6},true);assert.equal(stale.response.status,409);
 const current=await request('/api/stats');assert.equal(current.value.players[0].goals,5);assert.equal(current.value.players[0].assists,3);
});
test('preserves registrations/statistics across restart and invalidates sessions on logout',async()=>{
 await stop();await start();assert.equal((await request('/api/admin/session','GET',undefined,true)).response.status,401);
 assert.equal((await request('/api/stats')).value.players[0].goals,5);
 await login();assert.equal((await request('/api/admin/registrations','GET',undefined,true)).value.registrations.length,2);
 assert.equal((await request('/api/admin/logout','POST',{},true)).response.status,200);
 assert.equal((await request('/api/admin/players','GET',undefined,true)).response.status,401);
});
test('production refuses startup without durable data/password configuration',async()=>{
 const processChild=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,NODE_ENV:'production',ADMIN_PASSWORD:'',DATA_DIR:''},stdio:'ignore'});const[code]=await once(processChild,'exit');assert.notEqual(code,0);
});
