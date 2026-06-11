'use strict';

const TZ = 'America/Mexico_City';
let token = localStorage.getItem('wc_token') || null;
let me = null;

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('Session expired'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function fmtTime(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso)) + ' (MX)';
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 1600);
}

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Auth / view switching
// ---------------------------------------------------------------------------
async function refreshMe() {
  me = await api('/api/me');
  $('userbar').classList.remove('hidden');
  $('whoami').textContent = me.isAdmin
    ? (me.player ? `${me.player.name} · admin` : 'Admin')
    : me.player.name;
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !me.isAdmin));
  // Keep the Rules tab in sync with the configured scoring values.
  if (me.points) {
    $('rule-exact').textContent = me.points.exact;
    $('rule-diff').textContent = me.points.diff;
    $('rule-tendency').textContent = me.points.tendency;
  }
}

function logout() {
  if (token) api('/api/logout', { method: 'POST' }).catch(() => {});
  token = null; me = null;
  localStorage.removeItem('wc_token');
  $('appView').classList.add('hidden');
  $('userbar').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}

$('loginBtn').onclick = async () => {
  $('loginError').textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ name: $('loginName').value, pin: $('loginPin').value }),
    });
    token = data.token; localStorage.setItem('wc_token', token);
    await refreshMe(); loadAll();
  } catch (e) { $('loginError').textContent = e.message; }
};

$('adminBtn').onclick = async () => {
  $('loginError').textContent = '';
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ pin: $('adminPin').value }),
    });
    token = data.token; localStorage.setItem('wc_token', token);
    await refreshMe(); loadAll();
  } catch (e) { $('loginError').textContent = e.message; }
};

$('logoutBtn').onclick = logout;

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tabpanel').forEach((p) => p.classList.add('hidden'));
    $(`tab-${tab.dataset.tab}`).classList.remove('hidden');
    if (tab.dataset.tab === 'leaderboard') loadLeaderboard();
    if (tab.dataset.tab === 'admin') loadAdmin();
  };
});

function loadAll() {
  if (me.player) { loadMatches(); loadBonus(); }
  else { // admin-only login: jump to admin tab
    document.querySelector('[data-tab="admin"]').click();
  }
}

// ---------------------------------------------------------------------------
// Matches & tips
// ---------------------------------------------------------------------------
async function loadMatches() {
  const matches = await api('/api/matches');
  const host = $('matchList');
  host.innerHTML = '';
  let lastGroupKey = null;

  for (const m of matches) {
    const groupKey = m.round === 'Group' ? 'Group Stage' : m.roundLabel;
    if (groupKey !== lastGroupKey) {
      const h = document.createElement('div');
      h.className = 'group-title';
      h.textContent = groupKey;
      host.appendChild(h);
      lastGroupKey = groupKey;
    }

    const el = document.createElement('div');
    el.className = 'match' + (m.locked ? ' locked' : '');

    const resultOrInputs = m.locked
      ? `<span class="result">${m.played ? `${m.result.home} : ${m.result.away}` : '— : —'}</span>`
      : `<span class="score-inputs">
           <input type="number" min="0" max="99" value="${m.myTip ? m.myTip.home : ''}" data-mid="${m.id}" data-side="home" />
           <span class="vs">:</span>
           <input type="number" min="0" max="99" value="${m.myTip ? m.myTip.away : ''}" data-mid="${m.id}" data-side="away" />
           <button class="btn btn-sm" data-savetip="${m.id}">${m.myTip ? 'Saved ✓' : 'Save'}</button>
         </span>`;

    let reveal = '';
    if (m.locked) {
      const lines = [];
      if (m.myTip) {
        lines.push(tipLine('You', m.myTip.home, m.myTip.away, m.myPoints));
      }
      for (const o of m.otherTips) lines.push(tipLine(o.player, o.home, o.away, o.points));
      if (lines.length === 0) lines.push('<div class="tip-line"><span>No tips were entered.</span></div>');
      reveal = `<div class="tips-reveal">${lines.join('')}</div>`;
    }

    el.innerHTML = `
      <div class="match-head">
        <span>${m.venue || ''} · ${fmtTime(m.kickoffAt)}</span>
        <span class="badge ${m.locked ? 'locked' : 'open'}">${m.locked ? 'Locked' : 'Open'}</span>
      </div>
      <div class="teams-row">
        <span class="team home">${m.home}</span>
        ${resultOrInputs}
        <span class="team away">${m.away}</span>
      </div>
      ${reveal}`;
    host.appendChild(el);
  }

  // Save tips on button click. Typing marks the tip as unsaved.
  host.querySelectorAll('[data-savetip]').forEach((btn) => {
    const mid = btn.dataset.savetip;
    btn.onclick = () => saveTip(mid, host, btn);
    host.querySelectorAll(`input[data-mid="${mid}"]`).forEach((inp) => {
      inp.oninput = () => { btn.textContent = 'Save'; btn.classList.add('unsaved'); };
    });
  });
}

function tipLine(name, h, a, pts) {
  const ptsHtml = pts == null ? '' : `<span class="pts ${pts === 0 ? 'zero' : ''}">${pts} pts</span>`;
  return `<div class="tip-line"><span>${name}: <strong>${h} : ${a}</strong></span>${ptsHtml}</div>`;
}

async function saveTip(mid, host, btn) {
  const home = host.querySelector(`input[data-mid="${mid}"][data-side="home"]`).value;
  const away = host.querySelector(`input[data-mid="${mid}"][data-side="away"]`).value;
  if (home === '' || away === '') { toast('Enter both scores first'); return; }
  try {
    await api(`/api/matches/${mid}/tip`, { method: 'PUT', body: JSON.stringify({ home, away }) });
    if (btn) { btn.textContent = 'Saved ✓'; btn.classList.remove('unsaved'); }
    toast('Tip saved');
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------------------
// Bonus
// ---------------------------------------------------------------------------
async function loadBonus() {
  const qs = await api('/api/bonus');
  const host = $('bonusList');
  host.innerHTML = '';
  for (const q of qs) {
    const el = document.createElement('div');
    el.className = 'match' + (q.locked ? ' locked' : '');
    const inputs = [];
    for (let i = 0; i < q.answerCount; i++) {
      const val = q.myAnswer && q.myAnswer[i] ? q.myAnswer[i] : '';
      inputs.push(`<input type="text" data-qid="${q.id}" data-idx="${i}" value="${escapeAttr(val)}" placeholder="Answer ${q.answerCount > 1 ? i + 1 : ''}" ${q.locked ? 'disabled' : ''} />`);
    }
    let reveal = '';
    if (q.locked) {
      const lines = [];
      const correctTxt = q.correct ? ` · <span class="result">Correct: ${q.correct.join(', ')}</span>` : '';
      if (q.myAnswer) lines.push(tipLine('You', q.myAnswer.join(', '), '', q.myPoints).replace(' : ', ''));
      for (const o of q.otherAnswers) lines.push(`<div class="tip-line"><span>${o.player}: <strong>${o.answer.join(', ')}</strong></span>${o.points == null ? '' : `<span class="pts ${o.points === 0 ? 'zero' : ''}">${o.points} pts</span>`}</div>`);
      reveal = `<div class="tips-reveal">${lines.join('')}<div class="hint">${correctTxt}</div></div>`;
    }
    el.innerHTML = `
      <div class="match-head">
        <span>${q.points} pts${q.answerCount > 1 ? ' each' : ''}</span>
        <span class="badge ${q.locked ? 'locked' : 'open'}">${q.locked ? 'Locked' : 'Open'}</span>
      </div>
      <div class="team" style="margin-bottom:8px">${q.prompt}</div>
      <div class="score-inputs" style="flex-wrap:wrap">${inputs.join('')}</div>
      ${reveal}`;
    host.appendChild(el);
  }
  host.querySelectorAll('input[data-qid]').forEach((inp) => {
    inp.onchange = () => saveBonus(inp.dataset.qid, host);
  });
}

async function saveBonus(qid, host) {
  const answer = [...host.querySelectorAll(`input[data-qid="${qid}"]`)].map((i) => i.value).filter(Boolean);
  if (answer.length === 0) return;
  try {
    await api(`/api/bonus/${qid}/answer`, { method: 'PUT', body: JSON.stringify({ answer }) });
    toast('Answer saved');
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
async function loadLeaderboard() {
  const board = await api('/api/leaderboard');
  const host = $('leaderboard');
  const rows = board.map((b, i) => `
    <tr class="${me.player && b.player === me.player.name ? 'me' : ''}">
      <td>${i + 1}</td><td>${b.player}</td>
      <td class="num">${b.total}</td>
      <td class="num">${b.matchPoints}</td>
      <td class="num">${b.bonusPoints}</td>
      <td class="num">${b.exact}/${b.diff}/${b.tendency}</td>
    </tr>`).join('');
  host.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>Player</th><th class="num">Total</th><th class="num">Match</th><th class="num">Bonus</th><th class="num">Exact/Diff/Tend</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint">Points count only for matches with an entered result and resolved bonus questions.</p>`;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
async function loadAdmin() {
  const [matches, teams, bonus] = await Promise.all([
    api('/api/admin/matches'), api('/api/admin/teams'), api('/api/admin/bonus'),
  ]);

  // Matches: result + (knockout) name/time edit
  $('adminMatches').innerHTML = matches.map((m) => {
    const editNames = !m.homeCode; // knockout slots have no team code
    return `
    <div class="admin-row">
      <span class="label">${m.roundLabel} · ${fmtTime(m.kickoffAt)}<br/>
        ${editNames
          ? `<input type="text" value="${escapeAttr(m.home)}" data-am="${m.id}" data-f="home" style="width:120px" />
             vs
             <input type="text" value="${escapeAttr(m.away)}" data-am="${m.id}" data-f="away" style="width:120px" />`
          : `<strong>${m.home}</strong> vs <strong>${m.away}</strong>`}
      </span>
      <input type="number" min="0" placeholder="-" value="${m.homeScore ?? ''}" data-am="${m.id}" data-f="homeScore" style="width:52px" />
      <span class="vs">:</span>
      <input type="number" min="0" placeholder="-" value="${m.awayScore ?? ''}" data-am="${m.id}" data-f="awayScore" style="width:52px" />
      <button class="btn btn-sm" data-saveam="${m.id}">Save</button>
    </div>`;
  }).join('');

  $('adminMatches').querySelectorAll('[data-saveam]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.saveam;
      const get = (f) => {
        const el = $('adminMatches').querySelector(`[data-am="${id}"][data-f="${f}"]`);
        return el ? el.value : undefined;
      };
      const body = { homeScore: get('homeScore'), awayScore: get('awayScore') };
      if (get('home') !== undefined) { body.home = get('home'); body.away = get('away'); }
      try { await api(`/api/admin/matches/${id}`, { method: 'PUT', body: JSON.stringify(body) }); toast('Match saved'); }
      catch (e) { toast(e.message); }
    };
  });

  // Teams
  $('adminTeams').innerHTML = teams.map((t) => `
    <div class="admin-row">
      <span class="label">Group ${t.grp} · ${t.code}</span>
      <input type="text" value="${escapeAttr(t.name)}" data-team="${t.code}" />
      <button class="btn btn-sm" data-saveteam="${t.code}">Save</button>
    </div>`).join('');
  $('adminTeams').querySelectorAll('[data-saveteam]').forEach((btn) => {
    btn.onclick = async () => {
      const code = btn.dataset.saveteam;
      const name = $('adminTeams').querySelector(`[data-team="${code}"]`).value;
      try { await api(`/api/admin/teams/${code}`, { method: 'PUT', body: JSON.stringify({ name }) }); toast('Team saved'); }
      catch (e) { toast(e.message); }
    };
  });

  // Bonus
  $('adminBonus').innerHTML = bonus.map((q) => `
    <div class="admin-row">
      <span class="label">${q.prompt}<br/><span class="hint">${q.points} pts · ${q.answerCount} answer(s) · locks ${fmtTime(q.lockAt)}</span></span>
      <input type="text" value="${escapeAttr((q.correct || []).join(', '))}" data-bonus="${q.id}" placeholder="correct answer(s), comma-separated" style="width:240px" />
      <button class="btn btn-sm" data-savebonus="${q.id}">Save</button>
    </div>`).join('');
  $('adminBonus').querySelectorAll('[data-savebonus]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.savebonus;
      const raw = $('adminBonus').querySelector(`[data-bonus="${id}"]`).value;
      const correct = raw.split(',').map((s) => s.trim()).filter(Boolean);
      try { await api(`/api/admin/bonus/${id}`, { method: 'PUT', body: JSON.stringify({ correct }) }); toast('Bonus saved'); }
      catch (e) { toast(e.message); }
    };
  });
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  if (token) {
    try { await refreshMe(); loadAll(); }
    catch { logout(); }
  }
})();
