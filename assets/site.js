const categories = [
      {key:'goals', title:'TOP SCORERS', subtitle:'Goals', icon:'⚽'},
      {key:'assists', title:'TOP ASSISTS', subtitle:'Assists', icon:'↗'},
      {key:'contributions', title:'GOALS + ASSISTS', subtitle:'Goal contributions', icon:'★'},
      {key:'cleanSheets', title:'CLEAN SHEETS', subtitle:'Goalkeepers • matches without conceding', icon:'🧤'}
    ];
    let players=[],selectedAge='U10',statsFailed=false;
    const number=value=>Number.isFinite(value)&&value>=0?value:0;
    function renderLeaders(){
      const root=document.getElementById('leaderboards');root.replaceChildren();
      document.getElementById('stats-status').textContent=selectedAge+' • 2026/27 season';
      categories.forEach(category=>{
        const card=document.createElement('article');card.className='leader-card';
        const heading=document.createElement('div');heading.className='leader-heading';
        const icon=document.createElement('span');icon.className='leader-icon';icon.setAttribute('aria-hidden','true');icon.textContent=category.icon;
        const label=document.createElement('div'),title=document.createElement('h3'),subtitle=document.createElement('small');title.textContent=category.title;subtitle.textContent=category.subtitle;label.append(title,subtitle);heading.append(icon,label);card.append(heading);
        const score=player=>category.key==='contributions'?number(player.goals)+number(player.assists):number(player[category.key]);
        const leaders=players.filter(p=>p.ageGroup===selectedAge&&score(p)>0).sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name));
        if(!leaders.length){
          const empty=document.createElement('div');empty.className='stats-empty';const strong=document.createElement('strong'),message=document.createElement('p');strong.textContent=statsFailed?'Statistics temporarily unavailable':'The season starts here';message.textContent=statsFailed?'Please check back soon.':selectedAge+' leaders will appear once confirmed match statistics are available.';empty.append(strong,message);card.append(empty);
        }else{
          const list=document.createElement('ol');list.className='leader-list';let rank=0,previous=null;
          leaders.forEach((player,index)=>{const value=score(player);if(value!==previous)rank=index+1;previous=value;const row=document.createElement('li');row.className='leader-row';const position=document.createElement('span');position.className='leader-rank';position.textContent=rank;const name=document.createElement('div');name.className='leader-player';name.textContent=player.name;const club=document.createElement('small');club.textContent=player.club;name.append(club);const total=document.createElement('span');total.className='leader-value';total.textContent=value;row.append(position,name,total);list.append(row)});card.append(list);
        }
        root.append(card);
      });
    }
    document.querySelectorAll('[data-age]').forEach(tab=>tab.addEventListener('click',()=>{selectedAge=tab.dataset.age;document.querySelectorAll('[data-age]').forEach(t=>{const active=t===tab;t.classList.toggle('active',active);t.setAttribute('aria-pressed',String(active))});renderLeaders()}));
    renderLeaders();
    fetch('/api/stats').then(response=>{if(!response.ok)throw new Error('Statistics unavailable');return response.json()}).then(data=>{if(!Array.isArray(data.players))throw new Error('Invalid statistics');players=data.players.filter(p=>p&&typeof p.name==='string'&&typeof p.club==='string');renderLeaders()}).catch(()=>{statsFailed=true;renderLeaders()});
    const menu=document.querySelector('.menu'),links=document.querySelector('.links');
menu.addEventListener('click',()=>{const open=links.classList.toggle('is-open');menu.setAttribute('aria-expanded',String(open))});
links.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{links.classList.remove('is-open');menu.setAttribute('aria-expanded','false')}));

const leagueClubs=[
 {name:'Prairie Sky FC',slug:'prairie-sky',aliases:['Prairie Sky FC']},
 {name:'Dynamo Soccer Club',slug:'dynamo',aliases:['Dynamo']},
 {name:'Youth Football Club',slug:'yfc',aliases:['YFC']},
 {name:'Birds Academy',slug:'birds-academy',aliases:['Birds']},
 {name:'Green Strikers FC',slug:'green-strikers',aliases:['Green Strikers']},
 {name:'Shakhtar Academy Winnipeg',slug:'shakhtar',aliases:['Shakhtar Academy Winnipeg']}
];
function option(select,value,label){const item=document.createElement('option');item.value=value;item.textContent=label;select.append(item)}
leagueClubs.forEach(club=>option(document.getElementById('preferred-club'),club.name,club.name));
for(const kind of ['club','player']){
 const form=document.getElementById(kind+'-form');
 form.addEventListener('submit',async event=>{
  event.preventDefault();const feedback=form.querySelector('.form-feedback'),button=form.querySelector('[type=submit]');feedback.textContent='';feedback.className='form-feedback';
  const fields=new FormData(form),payload=Object.fromEntries(fields);payload.kind=kind;
  if(kind==='club'){payload.ageGroups=fields.getAll('ageGroups');if(!payload.ageGroups.length){feedback.textContent='Select at least one team age group.';feedback.classList.add('error');form.querySelector('[name=ageGroups]').focus();return}}
  else payload.age=Number(payload.age);
  button.disabled=true;
  try{const response=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});let data;try{data=await response.json()}catch{throw new Error('Registration service is temporarily unavailable. Please try again later.')}if(!response.ok)throw new Error(data.error||'Unable to submit registration.');form.reset();feedback.textContent='Registration received. Thank you! Your reference: '+data.id.slice(0,8).toUpperCase()+'.';feedback.classList.add('success')}
  catch(error){feedback.textContent=error.message==='Failed to fetch'?'Unable to connect. Please try again.':error.message;feedback.classList.add('error')}
  finally{button.disabled=false}
 });
}
document.querySelectorAll('[data-registration]').forEach(button=>button.addEventListener('click',()=>{
 document.querySelectorAll('[data-registration]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
 for(const kind of ['club','player'])document.getElementById(kind+'-form').hidden=kind!==button.dataset.registration;
}));
const dateSelect=document.getElementById('schedule-date'),ageSelect=document.getElementById('schedule-age'),clubSelect=document.getElementById('schedule-club');let schedule=[];
function clubFor(name){return leagueClubs.find(c=>c.name===name||c.aliases.includes(name))}
function displayClub(name){return clubFor(name)?.name||name}
function dateLabel(date){return new Intl.DateTimeFormat('en-CA',{weekday:'long',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))}
function renderSchedule(){
 const matches=schedule.filter(m=>(!dateSelect.value||m.date===dateSelect.value)&&(!ageSelect.value||m.ageGroup===ageSelect.value)&&(!clubSelect.value||m.home===clubSelect.value||m.away===clubSelect.value));const root=document.getElementById('schedule-list');root.replaceChildren();
 document.getElementById('schedule-summary').textContent=matches.length+' '+(matches.length===1?'match':'matches')+' • All times are local to Winnipeg.';
 if(!matches.length){const empty=document.createElement('p');empty.className='schedule-empty';empty.textContent='No matches for these filters. Try another matchday or club.';root.append(empty);return}
 for(const date of [...new Set(matches.map(m=>m.date))]){
  const group=document.createElement('div');group.className='matchday';const title=document.createElement('h3');title.className='matchday-title';title.textContent=dateLabel(date);const grid=document.createElement('div');grid.className='matches';
  for(const match of matches.filter(m=>m.date===date)){
   const card=document.createElement('article');card.className='match';const meta=document.createElement('div');meta.className='match-meta';const age=document.createElement('span');age.className='age';age.textContent=match.ageGroup+' • FIELD '+match.field;const time=document.createElement('span');time.textContent=match.start+'–'+match.end;meta.append(age,time);const teams=document.createElement('div');teams.className='clubs';
   [match.home,match.away].forEach((name,index)=>{if(index){const vs=document.createElement('div');vs.className='versus';vs.textContent='VS';teams.append(vs)}const row=document.createElement('div');row.className='club';const club=clubFor(name);if(club){const img=document.createElement('img');img.src='assets/'+club.slug+'.jpg';img.alt='';img.loading='lazy';row.append(img)}row.append(document.createTextNode(displayClub(name)));teams.append(row)});
   card.append(meta,teams);grid.append(card);
  }
  group.append(title,grid);root.append(group);
 }
}
[dateSelect,ageSelect,clubSelect].forEach(select=>select.addEventListener('change',renderSchedule));
fetch('assets/schedule.json').then(r=>{if(!r.ok)throw new Error();return r.json()}).then(data=>{
 schedule=data.matches;const dates=[...new Set(schedule.map(m=>m.date))].sort();dates.forEach(date=>option(dateSelect,date,dateLabel(date)));const names=[...new Set(schedule.flatMap(m=>[m.home,m.away]))].sort();names.forEach(name=>option(clubSelect,name,displayClub(name)));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());dateSelect.value=dates.find(d=>d>=today)||'';renderSchedule();
}).catch(()=>{document.getElementById('schedule-summary').textContent='Schedule temporarily unavailable. Please try again later.'});
