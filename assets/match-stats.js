(() => {
  const portal = window.SJL_PORTAL, $ = s => document.querySelector(s);
  let matches = [], detail = null, dirty = false, busy = false, request = 0;
  const age = $('#match-stats-age'), fixture = $('#match-stats-fixture'), club = $('#match-stats-club');
  const root = $('#match-stats-players'), status = $('#match-stats-status');
  const aliases = { Dynamo:'Dynamo Soccer Club', YFC:'Youth Football Club', Birds:'Birds Academy', 'Green Strikers':'Green Strikers FC' };
  const canonical = n => aliases[n] || n;
  const dateLabel = date => new Intl.DateTimeFormat('en-CA', { month:'short', day:'numeric', year:'numeric', timeZone:'UTC' }).format(new Date(date+'T12:00:00Z'));
  function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
  async function api(path = '', options = {}) {
    const epoch = portal.epoch;
    const r = await fetch(portal.prefix+'/match-stats'+path, { ...options, headers:{'Content-Type':'application/json'} });
    let data; try { data = await r.json(); } catch { throw Error('Unable to load match statistics. Please try again.'); }
    if (epoch !== portal.epoch) throw Error('Session changed. Sign in again.');
    if (r.status === 401) window.dispatchEvent(new Event('sjl-session-expired'));
    if (!r.ok) throw Error(data.error || 'Unable to save match statistics.'); return data;
  }
  function canLeave() { return !dirty || confirm('Discard unsaved match statistics?'); }
  function options(select, items) { select.replaceChildren(...items.map(([value,label]) => new Option(label,value))); }
  function fixtures() {
    const filtered = matches.filter(m => m.ageGroup === age.value);
    options(fixture, filtered.map(m => [m.id, dateLabel(m.date)+' · '+m.start+' · '+canonical(m.home)+' vs '+canonical(m.away)]));
    const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const recent = [...filtered].reverse().find(m => m.date <= today); if (recent) fixture.value = recent.id;
  }
  function clubsForMatch(preferred) {
    const m = matches.find(m => m.id === fixture.value);
    options(club, m ? (portal.clubMode ? [portal.club] : [canonical(m.home),canonical(m.away)]).map(n => [n,n]) : []);
    if ([...club.options].some(o => o.value === preferred)) club.value = preferred;
    club.disabled = portal.clubMode;
  }
  function lock(locked) {
    busy = locked;
    age.disabled = fixture.disabled = $('#refresh-match-stats').disabled = locked;
    club.disabled = locked || portal.clubMode;
    root.querySelectorAll('input,button').forEach(n => n.disabled = locked);
  }
  async function load() {
    const ticket = ++request, epoch = portal.epoch;
    dirty = false; detail = null; root.replaceChildren();
    if (!fixture.value) { message('No fixtures are scheduled for this age group.'); return; }
    lock(true); message('Loading match roster…');
    try {
      const data = await api('/'+encodeURIComponent(fixture.value)+'?club='+encodeURIComponent(club.value));
      if (ticket !== request || epoch !== portal.epoch) return;
      detail = data; render(); message(data.players.length ? 'Enter goals and assists for this match, then save each player.' : 'No players in this roster. Approve registrations in League Roster or add players in Player Statistics.');
    } catch (e) { if (ticket === request && epoch === portal.epoch) message(e.message,true); }
    finally { if (ticket === request && epoch === portal.epoch) lock(false); }
  }
  function render() {
    root.replaceChildren();
    for (const player of detail.players) {
      const report = detail.reports.find(r => r.playerId === player.id);
      const form = document.createElement('form'); form.className = 'match-stat-row';
      const name = document.createElement('div'); name.className = 'match-stat-name';
      const title = document.createElement('strong'); title.textContent = player.name;
      const season = document.createElement('small'); season.textContent = 'Season: '+player.goals+' goals · '+player.assists+' assists'; name.append(title,season);
      const inputs = {};
      for (const key of ['goals','assists']) {
        const label = document.createElement('label'); label.textContent = key === 'goals' ? 'Goals' : 'Assists';
        const input = document.createElement('input'); input.type='number'; input.min='0'; input.max='100'; input.step='1'; input.required=true; input.inputMode='numeric'; input.value=report?.[key] || 0;
        input.setAttribute('aria-label',label.textContent+' for '+player.name); input.addEventListener('input',()=>{form.dataset.dirty='true'; dirty=true;});
        label.append(input); inputs[key]=input; form.append(label);
      }
      form.prepend(name);
      const save = document.createElement('button'); save.type='submit'; save.className='primary'; save.textContent='SAVE PLAYER'; save.setAttribute('aria-label','Save match statistics for '+player.name);
      const feedback = document.createElement('p'); feedback.className='form-feedback'; feedback.setAttribute('role','status');
      form.append(save,feedback); root.append(form);
      let currentReport = report;
      form.addEventListener('submit',async event=>{
        event.preventDefault(); if (busy) return;
        const epoch=portal.epoch; lock(true); feedback.textContent='Saving…';
        try {
          const data = await api('/'+encodeURIComponent(detail.match.id)+'/players/'+encodeURIComponent(player.id),{method:'PUT',body:JSON.stringify({goals:Number(inputs.goals.value),assists:Number(inputs.assists.value),version:currentReport?.version||0,playerVersion:player.version})});
          if(epoch!==portal.epoch)return;
          Object.assign(player,data.player);currentReport=data.report;
          season.textContent='Season: '+player.goals+' goals · '+player.assists+' assists';
          form.dataset.dirty='false';dirty=Boolean(root.querySelector('[data-dirty=true]'));
          feedback.textContent='Saved. Season totals updated.';feedback.classList.remove('error');window.dispatchEvent(new Event('sjl-match-stats-updated'));
        } catch(e) { if(epoch===portal.epoch){feedback.textContent=e.message;feedback.classList.add('error');} }
        finally { if(epoch===portal.epoch)lock(false); }
      });
    }
  }
  let selectedAge='U10', selectedFixture='', selectedClub='';
  function remember(){selectedAge=age.value;selectedFixture=fixture.value;selectedClub=club.value;}
  for (const node of [age,fixture,club]) node.addEventListener('change',()=>{
    if (!canLeave()) {age.value=selectedAge;fixture.value=selectedFixture;club.value=selectedClub;return;}
    if(node===age)fixtures();if(node!==club)clubsForMatch(selectedClub);remember();void load();
  });
  $('#refresh-match-stats').addEventListener('click',()=>{if(canLeave())void load();});
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  window.addEventListener('sjl-admin-ready',async()=>{
    const epoch=portal.epoch;message('Loading matches…');
    try{const data=await api();if(epoch!==portal.epoch)return;matches=data.matches;fixtures();clubsForMatch(portal.club);remember();await load();}catch(e){if(epoch===portal.epoch)message(e.message,true);}
  });
  window.addEventListener('sjl-admin-logout',()=>{request++;matches=[];detail=null;dirty=false;busy=false;root.replaceChildren();fixture.replaceChildren();club.replaceChildren();message('');});
})();
