// Both portals share the same editor. Authorization always comes from the server session.
window.SJL_PORTAL = {
  clubMode: /^\/club\/?$/.test(location.pathname),
  club: null,
  epoch: 0,
  get prefix() { return this.clubMode ? '/api/club' : '/api/admin'; }
};
(() => {
  const p = window.SJL_PORTAL, $ = s => document.querySelector(s);
  const clubs = ['Prairie Sky FC','Dynamo Soccer Club','Youth Football Club','Birds Academy','Green Strikers FC','Shakhtar Academy Winnipeg'];
  const label = document.createElement('label'); label.textContent = 'Club';
  const select = document.createElement('select'); select.name = 'club'; select.required = p.clubMode;
  for (const name of ['', ...clubs]) { const o = document.createElement('option'); o.value = name; o.textContent = name || 'Choose your club'; select.append(o); }
  label.append(select); label.hidden = !p.clubMode; $('#login-form').prepend(label);
  if (p.clubMode) {
    document.title = 'Club Portal | Super Junior League';
    $('#login-view h1').textContent = 'CLUB SIGN IN';
    $('#login-view p').textContent = 'Choose your club and use the password provided by the league administrator.';
    $('#login-form label:has(input[type=password])').firstChild.textContent = 'Club password';
    document.querySelectorAll('[data-super-only]').forEach(n => n.hidden = true);
  }
  window.addEventListener('sjl-admin-ready', () => {
    if (!p.clubMode) { loadAccess(); return; }
    $('#dashboard h1').textContent = p.club;
    $('#dashboard .admin-top p').textContent = 'Club portal. Manage your players, team rosters and season statistics.';
    for (const id of ['admin-club','league-admin-club','league-filter-club']) {
      const node = $('#'+id);
      node.replaceChildren(new Option(p.club, p.club));
    }
    $('#league-filter-club').closest('label').hidden = true;
    $('.league-mail-settings').hidden = true;
    $('[data-admin-view=coach]').hidden = p.club !== 'Prairie Sky FC';
  });
  async function loadAccess() {
    const epoch=p.epoch;
    const root = $('#club-access-list'); root.replaceChildren();
    try {
      const r = await fetch('/api/admin/club-accounts'); const data = await r.json();
      if(epoch!==p.epoch)return;
      if (!r.ok) throw Error(data.error || 'Unable to load club access.');
      for (const account of data.accounts) {
        const form = document.createElement('form'); form.className = 'access-row admin-form';
        const title = document.createElement('h3'); title.textContent = account.club;
        const state = document.createElement('p'); state.textContent = account.enabled ? 'Access enabled' : 'Access disabled';
        const label = document.createElement('label'); label.textContent = 'New password (leave blank to keep the current password)';
        const password = document.createElement('input'); password.type = 'password'; password.minLength = 16; password.maxLength = 128; password.autocomplete = 'new-password'; label.append(password);
        const enabledLabel = document.createElement('label'); enabledLabel.className = 'access-check';
        const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = Boolean(account.enabled);
        enabledLabel.append(enabled, document.createTextNode('Enable this club login'));
        const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary'; save.textContent = 'SAVE CLUB ACCESS';
        const feedback = document.createElement('p'); feedback.setAttribute('role','status'); feedback.className = 'form-feedback';
        form.append(title,state,label,enabledLabel,save,feedback);
        form.addEventListener('submit', async event => {
          event.preventDefault(); save.disabled = true; feedback.textContent = 'Saving…';
          try {
            const r = await fetch('/api/admin/club-accounts/password', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({club:account.club,password:password.value,enabled:enabled.checked,version:account.version}) });
            const data = await r.json(); if (!r.ok) throw Error(data.error || 'Unable to save club access.');
            account.version++; password.value = ''; state.textContent = enabled.checked ? 'Access enabled' : 'Access disabled';
            feedback.textContent = 'Saved. Previous club sessions have been signed out.'; feedback.classList.remove('error');
          } catch (e) { feedback.textContent = e.message; feedback.classList.add('error'); }
          finally { save.disabled = false; }
        });
        root.append(form);
      }
    } catch (e) { root.textContent = e.message; }
  }
  $('#refresh-club-access').addEventListener('click', loadAccess);
  window.addEventListener('sjl-admin-logout', () => $('#club-access-list').replaceChildren());
})();
