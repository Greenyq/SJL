import { defaultRules, taskScore } from './coach-score.js';

const root = document.querySelector('#coach-app');
const portal = window.SJL_PORTAL;
let current = null, players = [], observations = new Map(), selected = null, draft = null, dirty = false, loading = false, saving = false;
let requestEpoch = 0;
const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const button = (text, action, className = 'secondary') => { const b = el('button', text, className); b.type = 'button'; b.addEventListener('click', action); return b; };
const field = (title, input) => { const l = el('label', title); l.append(input); return l; };
const input = (type, value) => { const n = el('input'); n.type = type; if (value !== undefined) n.value = value; return n; };
const picker = (values, placeholder) => { const n = el('select'); if (placeholder) n.append(new Option(placeholder, '')); for (const [value, label] of values) n.append(new Option(label, value)); return n; };
const status = el('p', '', 'form-feedback'); status.setAttribute('role', 'status');
const sessionSelect = picker([], 'Choose a saved session'); sessionSelect.setAttribute('aria-label', 'Saved coaching session');
const reload = button('REFRESH', () => refresh());
const exportButton = button('EXPORT CSV', exportCsv); exportButton.disabled = true;
const toolbar = el('div', undefined, 'coach-toolbar'); toolbar.append(field('Saved session', sessionSelect), reload, exportButton);
const newSession = el('details', undefined, 'coach-new'); newSession.append(el('summary', 'Create a session'));
const createForm = el('form', undefined, 'admin-form');
const nameInput = input('text'); nameInput.required = true; nameInput.maxLength = 100; nameInput.placeholder = 'e.g. League match vs Dynamo';
const today = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Winnipeg', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
const dateInput = input('date', today); dateInput.required = true;
const ageInput = picker([['U10','U10'],['U13','U13']]);
const basics = el('div', undefined, 'coach-form-grid'); basics.append(field('Session name', nameInput), field('Date', dateInput), field('Age group', ageInput));
const rulesPanel = el('details'); rulesPanel.append(el('summary', 'Task targets and scoring'));
const rulesGrid = el('div', undefined, 'coach-form-grid');
const ruleInputs = {};
for (const [key,label] of [['goals','Forward goals'],['assists','Forward assists'],['combined','Combined goal contributions'],['wingerDuels','Winger duels won'],['passes','Winger completed passes'],['defenderDuels','Defender duels won']]) {
  const n = input('number', defaultRules[key]); n.min = 1; n.max = 10000; n.step = 1; n.required = true; ruleInputs[key] = n; rulesGrid.append(field(label, n));
}
const mode = picker([['Either','Goals OR assists'],['Both','Goals AND assists'],['Combined','Goals + assists combined']]);
rulesPanel.append(field('Forward scoring mode',mode),rulesGrid,el('p','Each winger task contributes 50%. Each task is capped at 100%. Goalkeepers can have notes but have no automatic rating. Rules are saved with this session.','form-help'));
const createButton = el('button','CREATE SESSION','primary'); createButton.type = 'submit';
createForm.append(basics,rulesPanel,createButton); newSession.append(createForm);
const summary = el('p');
const layout = el('div',undefined,'coach-workspace');
const roster = el('div',undefined,'coach-roster'); roster.setAttribute('aria-label','Players in this session');
const editor = el('div',undefined,'coach-editor'); layout.append(roster,editor);
root.append(toolbar,newSession,status,summary,layout);

function message(text,error=false) { status.textContent = text; status.classList.toggle('error',error); }
function canLeave() { return !loading && !saving && (!dirty || window.confirm('This player has unsaved changes. Discard them?')); }
function busy(value) { loading=value;root.inert=value;reload.disabled=value;sessionSelect.disabled=value; }
async function api(path,method='GET',data) {
  const epoch=portal.epoch;
  const r = await fetch(`${portal.prefix}/coach${path}`,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  let result; try { result = await r.json(); } catch { throw Error('Server unavailable. Check your connection and try again.'); }
  if(epoch!==portal.epoch)throw Error('Session changed. Sign in again.');
  if (!r.ok) { if (r.status === 401) window.dispatchEvent(new Event('sjl-session-expired')); throw Error(result.error || 'Unable to save. Try again.'); }
  return result;
}
async function refresh() {
  if (loading || !canLeave()) return;
  const ticket=++requestEpoch;busy(true);message('Loading coaching sessions…');
  try {
    const data = await api('/sessions');if(ticket!==requestEpoch)return;
    sessionSelect.replaceChildren(new Option('Choose a saved session',''));
    for (const s of data.sessions) sessionSelect.append(new Option(`${s.date} · ${s.ageGroup} · ${s.label}`,s.id));
    if (current && data.sessions.some(s=>s.id===current.id)) { sessionSelect.value = current.id; await loadSession(current.id,ticket); }
    else { current = null;dirty=false;clearSession();newSession.open = !data.sessions.length; message(data.sessions.length ? 'Choose a session to continue.' : 'Create your first session. Approved Prairie Sky players will appear automatically.'); }
  } catch(e) { if(ticket===requestEpoch)message(e.message,true); } finally { if(ticket===requestEpoch)busy(false); }
}
function clearSession() { players=[]; observations.clear(); selected=null; draft=null; roster.replaceChildren(); editor.replaceChildren(); summary.textContent=''; exportButton.disabled=true; }
async function loadSession(id,existingTicket) {
  const ticket=existingTicket??++requestEpoch;
  busy(true);message('Loading players…');
  try {
    const data = await api('/sessions/'+encodeURIComponent(id));
    if(ticket!==requestEpoch)return;
    current=data.session;players=data.players;observations=new Map(data.observations.map(o=>[o.entryId,o]));dirty=false;draft=null;
    selected=players.find(p=>p.id===selected)?.id||players[0]?.id||null;
    renderRoster(); selectPlayer(selected); newSession.open=false; exportButton.disabled=false; message('Session loaded. Evaluations are private.');
  } finally { if(ticket===requestEpoch)busy(false); }
}
sessionSelect.addEventListener('change', async()=>{
  const id=sessionSelect.value;
  if (!canLeave()) {sessionSelect.value=current?.id||'';return;}
  if (!id) {dirty=false;current=null;clearSession();return;}
  const expected=requestEpoch+1;
  try {await loadSession(id);} catch(e){if(expected===requestEpoch){sessionSelect.value=current?.id||'';message(e.message,true);}}
});
createForm.addEventListener('submit',async event=>{
  event.preventDefault();if(!canLeave())return;const ticket=++requestEpoch;busy(true);createButton.disabled=true;
  try {
    const rules={forwardMode:mode.value};for(const[k,n]of Object.entries(ruleInputs))rules[k]=Number(n.value);
    const data=await api('/sessions','POST',{label:nameInput.value,date:dateInput.value,ageGroup:ageInput.value,rules});
    if(ticket!==requestEpoch)return;
    sessionSelect.append(new Option(`${data.session.date} · ${data.session.ageGroup} · ${data.session.label}`,data.session.id));
    await loadSession(data.session.id,ticket);
    if(ticket===requestEpoch){sessionSelect.value=current.id;message('Session created. Select a player and assign a role.');}
  } catch(e){if(ticket===requestEpoch)message(e.message,true);}finally{if(ticket===requestEpoch){busy(false);createButton.disabled=false;}}
});
function renderRoster() {
  roster.replaceChildren();
  const saved=players.filter(p=>observations.has(p.id)).length;
  summary.textContent=`${current.date} · ${current.ageGroup} · ${current.label}. ${saved} of ${players.length} players evaluated.`;
  if(!players.length){editor.replaceChildren(el('p','No approved Prairie Sky players in this age group. Approve existing registrations in League Roster first.','admin-empty'));return;}
  for(const p of players){
    const b=button('',()=>{if(!canLeave())return;dirty=false;selectPlayer(p.id);},'coach-player');b.dataset.player=p.id;
    b.append(el('span',p.name),el('small',scoreLabel(observations.get(p.id))));b.setAttribute('aria-pressed',String(p.id===selected));roster.append(b);
  }
  const historical=[...observations.values()].filter(o=>!players.some(p=>p.id===o.entryId));
  if(historical.length){const details=el('details');details.append(el('summary','Earlier roster evaluations'));for(const o of historical)details.append(el('p',o.playerName+': '+scoreLabel(o)));roster.append(details);}
}
function scoreLabel(o) {if(!o)return 'Not evaluated';if(!o.role)return 'Choose a role';const s=taskScore(o.role,o.stats,current.rules);return o.role==='Goalkeeper'?'Goalkeeper · Notes only':`${o.role} · ${s.rating.toFixed(1)} / 10`;}
function selectPlayer(id) {
  selected=id;const player=players.find(p=>p.id===id);if(!player)return;
  const stored=observations.get(id);
  draft=stored?structuredClone(stored):{role:['Juan Cepeda','Mykyta Syvak'].includes(player.name)?'Goalkeeper':'',stats:{goals:0,assists:0,duels:0,passes:0},notes:'',version:0};
  editor.replaceChildren();editor.append(el('h3',player.name));
  const role=picker([['Forward','Forward'],['Winger','Winger'],['Defender','Defender'],['Goalkeeper','Goalkeeper']],'Choose a role');role.value=draft.role;
  const target=el('p',undefined,'coach-target');
  const output=el('output',undefined,'coach-rating');output.setAttribute('aria-live','polite');
  const statsGrid=el('div',undefined,'coach-counters');
  const notes=el('textarea');notes.value=draft.notes;notes.maxLength=1000;notes.rows=3;
  const save=el('button','SAVE EVALUATION','primary');save.type='button';save.disabled=true;
  const savedState=el('p',stored?'Saved':'Choose a role, record actions and save.','form-feedback');savedState.setAttribute('role','status');
  const form=el('form',undefined,'admin-form');form.append(field('Role for this session',role),target,output,statsGrid,field('Coach notes',notes),save,savedState);editor.append(form);
  function touch(){dirty=true;save.disabled=false;savedState.textContent='Unsaved changes';update();}
  function update(){
    const rules=current.rules;
    target.textContent=draft.role==='Forward'?(rules.forwardMode==='Combined'?`Target: ${rules.combined} goals + assists combined.`:`Target: ${rules.goals} goals ${rules.forwardMode==='Both'?'AND':'OR'} ${rules.assists} assists.`):draft.role==='Winger'?`Targets: ${rules.wingerDuels} duels won AND ${rules.passes} completed passes.`:draft.role==='Defender'?`Target: ${rules.defenderDuels} duels won.`:draft.role==='Goalkeeper'?'Goalkeeper tasks have not been configured. Save notes without a rating.':'Assign a role to see the tasks.';
    const s=taskScore(draft.role,draft.stats,rules);output.textContent=s.rating===null?'No rating':`${s.rating.toFixed(1)} / 10 — ${Math.round(s.completion*100)}% complete`;
    const keys=draft.role==='Forward'?['goals','assists']:draft.role==='Winger'?['duels','passes']:draft.role==='Defender'?['duels']:[];
    for(const node of statsGrid.children)node.hidden=!keys.includes(node.dataset.metric);
    for(const b of roster.querySelectorAll('[data-player]')){b.setAttribute('aria-pressed',String(b.dataset.player===selected));if(b.dataset.player===selected)b.querySelector('small').textContent=(dirty?'Unsaved · ':'')+scoreLabel(draft);}
  }
  for(const [key,label]of [['goals','Goals'],['assists','Assists'],['duels','Duels won'],['passes','Completed passes']]){
    const group=el('div',undefined,'coach-counter');group.dataset.metric=key;
    const n=input('number',draft.stats[key]);n.min=0;n.max=10000;n.step=1;n.required=true;n.setAttribute('aria-label',label);
    const step=delta=>{const next=Math.max(0,Math.min(10000,Number(n.value||0)+delta));n.value=next;draft.stats[key]=next;touch();};
    const minus=button('−',()=>step(-1),'secondary coach-step');minus.setAttribute('aria-label',`Decrease ${label.toLowerCase()} for ${player.name}`);
    const plus=button('+',()=>step(1),'primary coach-step');plus.setAttribute('aria-label',`Increase ${label.toLowerCase()} for ${player.name}`);
    n.addEventListener('input',()=>{if(n.value!==''&&n.validity.valid){draft.stats[key]=Number(n.value);touch();}else{dirty=true;save.disabled=true;savedState.textContent='Enter a whole number between 0 and 10000.';}});
    const control=el('div',undefined,'coach-counter-controls');control.append(minus,n,plus);group.append(el('span',label),control);statsGrid.append(group);
  }
  role.addEventListener('change',()=>{draft.role=role.value;touch();});notes.addEventListener('input',()=>{draft.notes=notes.value;touch();});
  form.addEventListener('submit',e=>e.preventDefault());
  save.addEventListener('click',async()=>{
    if(loading||saving)return;
    if(!draft.role){savedState.textContent='Choose a role before saving.';return;}
    if(!form.reportValidity())return;
    const ticket=++requestEpoch,playerId=selected,sessionId=current.id;
    saving=true;root.inert=true;save.disabled=true;for(const control of form.querySelectorAll('input,select,textarea,button'))control.disabled=true;sessionSelect.disabled=true;reload.disabled=true;createButton.disabled=true;
    savedState.textContent='Saving…';
    try{const data=await api(`/sessions/${sessionId}/players/${playerId}`,'PUT',draft);if(ticket!==requestEpoch)return;observations.set(playerId,data.observation);draft=structuredClone(data.observation);dirty=false;renderRoster();update();savedState.textContent='Saved';}
    catch(e){if(ticket===requestEpoch){savedState.textContent=e.message;savedState.classList.add('error');}}
    finally{if(ticket===requestEpoch){saving=false;root.inert=false;for(const control of form.querySelectorAll('input,select,textarea,button'))control.disabled=false;save.disabled=!dirty;sessionSelect.disabled=false;reload.disabled=false;createButton.disabled=false;}}
  });
  update();
}
function exportCsv(){
  if(!current)return;if(dirty){message('Save the current evaluation before exporting.',true);return;}
  const cell=value=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const rows=[['Date','Session','Age group','Player','Role','Goals','Assists','Duels won','Completed passes','Rating / 10','Completion','Coach notes']];
  for(const o of observations.values()){const s=taskScore(o.role,o.stats,current.rules);rows.push([current.date,current.label,current.ageGroup,o.playerName,o.role,o.stats.goals,o.stats.assists,o.stats.duels,o.stats.passes,s.rating,s.completion===null?'':Math.round(s.completion*100)+'%',o.notes]);}
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}));const a=el('a');a.href=url;a.download=`Prairie-Sky-${current.ageGroup}-${current.date}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('sjl-admin-logout',()=>{requestEpoch++;dirty=false;saving=false;busy(false);current=null;clearSession();sessionSelect.replaceChildren(new Option('Choose a saved session',''));nameInput.value='';createButton.disabled=false;message('');});
document.querySelector('[data-admin-view=coach]').addEventListener('click',()=>{if(!current)refresh();});
