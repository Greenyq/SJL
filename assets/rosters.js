(()=>{
 const dialog=document.getElementById('club-roster-dialog');
 const root=document.getElementById('roster-players'),count=document.getElementById('roster-count'),retry=document.getElementById('roster-retry');
 const clubs={
  'Prairie Sky FC':'prairie-sky','Dynamo Soccer Club':'dynamo','Youth Football Club':'yfc',
  'Birds Academy':'birds-academy','Green Strikers FC':'green-strikers','Shakhtar Academy Winnipeg':'shakhtar'
 };
 let club='',age='U10',teams=[],state='loading',controller;
 function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n}
 function render(){
  root.replaceChildren();retry.hidden=state!=='error';
  for(const button of dialog.querySelectorAll('[data-roster-age]')){
   const active=button.dataset.rosterAge===age;
   button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  }
  if(state!=='ready'){
   count.textContent=state==='loading'?'Loading roster…':'Roster unavailable';
   root.append(el('p',state==='loading'?'Loading confirmed players…':'We could not load this roster. Please try again.','roster-empty'));return;
  }
  const selected=teams.filter(t=>t.club===club&&t.ageGroup===age),total=selected.reduce((n,t)=>n+t.players.length,0);
  count.textContent=total+' public '+(total===1?'player':'players')+' • '+age;
  if(!total){root.append(el('p',selected.length?'No players are published for this team yet. Confirmed players will appear here when public-statistics permission is enabled.':'This club does not currently have a registered '+age+' team.','roster-empty'));return}
  for(const team of selected.filter(t=>t.players.length)){
   if(selected.length>1)root.append(el('h3',team.name,'roster-team-title'));
   const wrap=el('div',undefined,'roster-table-wrap'),table=el('table',undefined,'roster-table');
   const caption=el('caption',team.name+' — confirmed players and season statistics','visually-hidden');
   const head=el('thead'),header=el('tr');
   for(const label of ['Player','Goals','Assists','Clean sheets']){const th=el('th',label);th.scope='col';header.append(th)}
   head.append(header);const body=el('tbody');
   for(const player of team.players){const row=el('tr'),name=el('th',player.name);name.scope='row';row.append(name);for(const key of ['goals','assists','cleanSheets'])row.append(el('td',String(player[key])));body.append(row)}
   table.append(caption,head,body);wrap.append(table);root.append(wrap);
  }
 }
 async function load(){
  controller?.abort();const request=new AbortController();controller=request;state='loading';teams=[];render();
  try{
   const response=await fetch('/api/league/rosters',{signal:request.signal,cache:'no-store'});
   if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.teams))throw Error();
   if(request.signal.aborted)return;teams=data.teams;state='ready';render();
  }catch(error){if(request.signal.aborted)return;state='error';render()}
 }
 document.querySelectorAll('[data-roster-club]').forEach(button=>button.addEventListener('click',()=>{
  club=button.dataset.rosterClub;age='U10';document.getElementById('roster-title').textContent=club;
  document.getElementById('roster-logo').src='/assets/'+clubs[club]+'.jpg';
  dialog.showModal();document.documentElement.classList.add('roster-open');void load();
 }));
 for(const button of dialog.querySelectorAll('[data-roster-age]'))button.addEventListener('click',()=>{age=button.dataset.rosterAge;render()});
 retry.addEventListener('click',load);
 dialog.addEventListener('close',()=>{controller?.abort();document.documentElement.classList.remove('roster-open')});
 dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close()});
 document.getElementById('roster-schedule-link').addEventListener('click',()=>{
  window.dispatchEvent(new CustomEvent('sjl-club-schedule',{detail:{club,ageGroup:age}}));dialog.close();
 });
})();
