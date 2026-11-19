/* PropSeek landing admin — static app on GitHub Pages, data in Supabase */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const cfg = window.LP_SUPABASE || {};
  if (!cfg.url || /YOUR-PROJECT/.test(cfg.url) || !cfg.anonKey || /YOUR-/.test(cfg.anonKey)) { $('#noConfig').hidden = false; return; }
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  /* ---------------- helpers ---------------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = n => Number(n || 0).toLocaleString();
  function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(t._h); t._h = setTimeout(() => t.className = '', 3200); }
  function fail(e) { console.error(e); toast((e && (e.message || e.error_description)) || 'Something went wrong', true); }

  let S = {}; // settings
  let STATUSES = [];
  const TZ = () => S.timezone || 'Australia/Melbourne';
  const statusOf = k => STATUSES.find(s => s.key === k) || { key: k, label: k, color: '#6b7280' };
  const badge = k => { const s = statusOf(k); return `<span class="badge" style="--c:${esc(s.color)}">${esc(s.label)}</span>`; };
  const statusSelect = (cur, attrs = '') => `<select class="st-sel" style="--c:${esc(statusOf(cur).color)}" ${attrs}>` +
    STATUSES.map(o => `<option value="${esc(o.key)}" ${o.key === cur ? 'selected' : ''}>${esc(o.label)}</option>`).join('') + '</select>';

  function fmtDate(ts, opt) {
    if (!ts) return '';
    return new Intl.DateTimeFormat('en-AU', Object.assign({ timeZone: TZ(), day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }, opt || {})).format(new Date(ts));
  }
  function todayLocal(offsetDays = 0) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  // local date "YYYY-MM-DD" (report timezone) -> UTC ISO string at local midnight
  function localDayToUtc(ymd, plusDays = 0) {
    const [y, m, d] = ymd.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d + plusDays);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(guess)).reduce((a, p) => (a[p.type] = p.value, a), {});
    const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return new Date(guess - (asLocal - guess)).toISOString();
  }
  const fmtMobile = m => String(m || '').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
  function sourceLabel(r) {
    if (r.utm_source) return r.utm_source.toLowerCase();
    if (r.fbclid) return 'facebook';
    if (r.gclid) return 'google ads';
    if (!r.referrer) return 'direct';
    let h = ''; try { h = new URL(r.referrer).hostname.toLowerCase().replace(/^(www\.|m\.|l\.|lm\.)/, ''); } catch (e) { return 'direct'; }
    if (h.includes('facebook') || h.startsWith('fb.')) return 'facebook';
    if (h.includes('instagram')) return 'instagram';
    if (h.includes('google')) return 'google';
    return h || 'direct';
  }

  async function loadSettings() {
    const { data, error } = await sb.from('settings').select('k,v');
    if (error) throw error;
    S = {}; data.forEach(r => S[r.k] = r.v);
    STATUSES = Array.isArray(S.statuses) && S.statuses.length ? S.statuses : [{ key: 'new', label: 'New', color: '#3b82f6' }];
  }
  async function saveSetting(k, v) {
    const { error } = await sb.from('settings').upsert({ k, v });
    if (error) throw error;
    S[k] = v;
  }

  /* ---------------- auth ---------------- */
  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    const { data: isAdmin, error } = await sb.rpc('is_admin');
    if (error) return fail(error);
    if (!isAdmin) {
      $('#loginView').hidden = true; $('#notAdmin').hidden = false;
      $('#naEmail').textContent = session.user.email;
      $('#naSql').textContent = `insert into public.admins (email) values ('${session.user.email}');`;
      return;
    }
    try { localStorage.setItem('lp_admin', '1'); } catch (e) {} // don't count my own visits on the landing page
    $('#loginView').hidden = true; $('#notAdmin').hidden = true; $('#app').hidden = false;
    $('#meEmail').textContent = session.user.email;
    $('#sbUrl').textContent = cfg.url;
    await loadSettings();
    route();
    refreshNewPill();
  }
  function showLogin() { $('#app').hidden = true; $('#notAdmin').hidden = true; $('#loginView').hidden = false; }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button');
    btn.disabled = true; $('#loginErr').hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false;
    if (error) { $('#loginErr').textContent = error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message; $('#loginErr').hidden = false; return; }
    boot();
  });
  const logout = async e => { e && e.preventDefault(); await sb.auth.signOut(); location.hash = ''; location.reload(); };
  $('#logout').addEventListener('click', logout);
  $('#naOut').addEventListener('click', logout);

  async function refreshNewPill() {
    const { count } = await sb.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new');
    $('#newPill').hidden = !count; $('#newPill').textContent = count || '';
  }

  /* ---------------- routing ---------------- */
  const TITLES = { dashboard: 'Dashboard', leads: 'Leads', settings: 'Settings' };
  function route() {
    const v = (location.hash.replace('#', '').split('?')[0]) || 'dashboard';
    const view = TITLES[v] ? v : 'dashboard';
    $$('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + view));
    $$('.side nav a[data-view]').forEach(a => a.classList.toggle('on', a.dataset.view === view));
    $('#title').textContent = TITLES[view];
    $('#side').classList.remove('open');
    if (view === 'dashboard') Dash.load();
    if (view === 'leads') Leads.load();
    if (view === 'settings') Settings.render();
  }
  $$('.side nav a[data-view]').forEach(a => a.addEventListener('click', () => { location.hash = a.dataset.view; }));
  window.addEventListener('hashchange', () => { if (!$('#app').hidden) route(); });

  /* ================= DASHBOARD ================= */
  const Dash = (function () {
    const GOLD = '#b8862f', GOLD2 = '#d9b257', INK = '#2a241b', BLUE = '#3b82f6', GREEN = '#10b981';
    const PALETTE = ['#b8862f', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b', '#06b6d4', '#6b7280', '#ec4899', '#84cc16'];
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = '#6f675b';
    Chart.defaults.plugins.legend.labels.boxWidth = 10; Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.maintainAspectRatio = false;
    const grid = { color: 'rgba(0,0,0,.05)' }, charts = {};
    const make = (id, c) => { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), c); };
    let state = { range: '30' }, timer = null;

    async function rangeDates() {
      const to = todayLocal();
      if (state.range === 'custom') return [state.from, state.to];
      if (state.range === 'today') return [to, to];
      if (state.range === 'yesterday') { const y = todayLocal(-1); return [y, y]; }
      if (state.range === 'all') {
        const [a, b] = await Promise.all([
          sb.from('events').select('created_at').order('created_at').limit(1),
          sb.from('leads').select('created_at').order('created_at').limit(1)]);
        const ts = [a.data && a.data[0], b.data && b.data[0]].filter(Boolean).map(x => x.created_at).sort()[0];
        return [ts ? fmtLocalDay(ts) : to, to];
      }
      return [todayLocal(-(+state.range - 1)), to];
    }
    const fmtLocalDay = ts => new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));

    async function load() {
      clearInterval(timer);
      timer = setInterval(() => { if ($('#v-dashboard').classList.contains('on') && !document.hidden) load(); }, 60000);
      const [from, to] = await rangeDates();
      const { data, error } = await sb.rpc('dashboard_stats', { p_from: from, p_to: to });
      if (error) return fail(error);
      render(data);
    }

    function doughnut(id, labels, data, colors) {
      const empty = !data.some(Boolean);
      make(id, { type: 'doughnut', data: { labels: empty ? ['No data'] : labels, datasets: [{ data: empty ? [1] : data, backgroundColor: empty ? ['#eee'] : colors, borderWidth: 2, borderColor: '#fff' }] },
        options: { cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: { enabled: !empty } } } });
    }

    function render(d) {
      $('#live').textContent = d.live; $('#dFrom').value = d.from; $('#dTo').value = d.to;
      $$('.kpi').forEach(el => {
        const k = el.dataset.k, v = +d.kpi[k], p = +d.kpi_prev[k], suf = el.dataset.suf, em = el.querySelector('em');
        el.querySelector('b').textContent = fmtN(v) + suf;
        em.title = 'vs ' + d.prev.from + ' → ' + d.prev.to;
        if (state.range === 'all') { em.textContent = ''; return; }
        if (!p) { em.textContent = v ? 'new' : ''; em.className = v ? 'up' : ''; return; }
        const ch = suf === '%' ? v - p : (v - p) / p * 100, mag = Math.abs(ch);
        em.textContent = (ch >= 0 ? '▲ ' : '▼ ') + (suf !== '%' && mag > 999 ? '999+' : mag.toFixed(suf === '%' ? 1 : 0)) + (suf === '%' ? ' pts' : '%');
        em.className = ch >= 0 ? 'up' : 'down';
      });
      const cap = d.capacity;
      $('#capCard').hidden = !(cap.total > 0);
      if (cap.total > 0) { const pct = Math.min(100, cap.booked / cap.total * 100); $('#capTxt').textContent = `${cap.booked} / ${cap.total} seats booked (${pct.toFixed(0)}%)`; $('#capBar').style.width = pct + '%'; }

      const many = d.daily.length > 40;
      make('cTrend', { data: { labels: d.daily.map(x => new Date(x.d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })), datasets: [
        { type: 'bar', label: 'Leads', data: d.daily.map(x => x.leads), backgroundColor: GOLD, borderRadius: 4, yAxisID: 'y1', order: 2 },
        { type: 'line', label: 'Unique visitors', data: d.daily.map(x => x.visitors), borderColor: BLUE, backgroundColor: 'rgba(59,130,246,.08)', fill: true, tension: .35, pointRadius: many ? 0 : 3, order: 1 },
        { type: 'line', label: 'CTA clicks', data: d.daily.map(x => x.cta_clicks), borderColor: GREEN, tension: .35, pointRadius: many ? 0 : 3, borderDash: [5, 4], order: 1 }] },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', align: 'end' } },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid, title: { display: true, text: 'Visitors / clicks' }, ticks: { precision: 0 } },
            y1: { beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: 'Leads' }, ticks: { precision: 0 } } } } });

      const top = +d.funnel[0][1] || 1;
      make('cFunnel', { type: 'bar', data: { labels: d.funnel.map(f => f[0]), datasets: [{ data: d.funnel.map(f => +f[1]), backgroundColor: ['#e9d9b0', '#dcc283', GOLD2, '#c99a3e', GOLD], borderRadius: 6 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtN(c.raw) + ' (' + (c.raw / top * 100).toFixed(1) + '% of visitors)' } } },
          scales: { x: { beginAtZero: true, grid, ticks: { precision: 0 } }, y: { grid: { display: false } } } } });

      doughnut('cStatus', d.status.map(s => statusOf(s.key).label), d.status.map(s => s.n), d.status.map(s => statusOf(s.key).color));
      doughnut('cDevices', d.devices.map(x => x.device), d.devices.map(x => x.n), [INK, GOLD, '#9ca3af', '#ddd']);
      make('cSources', { type: 'bar', data: { labels: d.sources.map(s => s.label), datasets: [
        { label: 'Visitors', data: d.sources.map(s => s.visitors), backgroundColor: '#cbd5e1', borderRadius: 4 },
        { label: 'Leads', data: d.sources.map(s => s.leads), backgroundColor: GOLD, borderRadius: 4 }] },
        options: { plugins: { legend: { position: 'top', align: 'end' } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid, ticks: { precision: 0 } } } } });
      make('cCtas', { type: 'bar', data: { labels: d.ctas.map(c => c.label), datasets: [{ label: 'Clicks', data: d.ctas.map(c => c.n), backgroundColor: GREEN, borderRadius: 4 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid, ticks: { precision: 0 } }, y: { grid: { display: false } } } } });
      make('cHours', { type: 'bar', data: { labels: d.hours.map((_, i) => (i % 12 || 12) + (i < 12 ? 'a' : 'p')), datasets: [{ label: 'Leads', data: d.hours, backgroundColor: GOLD2, borderRadius: 3 }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid, ticks: { precision: 0 } } } } });
      doughnut('cSuper', d.super.map(s => s.b), d.super.map(s => s.n), PALETTE);

      $('#tCamp tbody').innerHTML = d.campaigns.length ? d.campaigns.map(c => `<tr><td>${esc(c.c)}</td><td class="r">${c.n}</td><td class="r">${c.s}</td></tr>`).join('')
        : '<tr><td colspan="3" class="empty">No leads in this period</td></tr>';
      $('#recent').innerHTML = d.recent.length ? d.recent.map(r => `<li><a href="#leads" data-open="${r.id}"><b>${esc(r.first_name)} ${esc(r.last_name)}</b><small>${esc(fmtDate(r.created_at))} · ${esc(r.source)} · ${r.seats} seat${r.seats > 1 ? 's' : ''}</small></a>${badge(r.status)}</li>`).join('')
        : '<li class="empty">No leads yet</li>';
      $$('#recent [data-open]').forEach(a => a.addEventListener('click', () => { Leads.openAfterLoad = +a.dataset.open; }));
    }

    $$('#range button').forEach(b => b.onclick = () => { $$('#range button').forEach(x => x.classList.remove('on')); b.classList.add('on'); state = { range: b.dataset.r }; load(); });
    $('#applyCustom').onclick = () => { const f = $('#dFrom').value, t = $('#dTo').value; if (!f || !t) return; $$('#range button').forEach(x => x.classList.remove('on')); state = { range: 'custom', from: f, to: t }; load(); };
    return { load };
  })();

  /* ================= LEADS ================= */
  const Leads = (function () {
    const PER = 50;
    let f = { q: '', status: '', from: '', to: '', n8n: '', dup: false }, sort = { col: 'created_at', asc: false }, page = 1, rows = [];
    const api = { openAfterLoad: null };

    function applyFilters(q) {
      const words = f.q.replace(/[,()*%\\]/g, ' ').trim().split(/\s+/).filter(Boolean);
      words.forEach(w => {
        const digits = w.replace(/\D/g, '');
        const ors = [`first_name.ilike.*${w}*`, `last_name.ilike.*${w}*`, `email.ilike.*${w}*`, `utm_campaign.ilike.*${w}*`, `notes.ilike.*${w}*`];
        if (digits.length >= 3) ors.push(`mobile.ilike.*${digits}*`);
        q = q.or(ors.join(','));
      });
      if (f.status) q = q.eq('status', f.status);
      if (f.from) q = q.gte('created_at', localDayToUtc(f.from));
      if (f.to) q = q.lt('created_at', localDayToUtc(f.to, 1));
      if (f.n8n) q = q.eq('n8n_status', f.n8n);
      if (f.dup) q = q.eq('is_duplicate', true);
      return q;
    }

    async function load() {
      $('#leadRows').innerHTML = '<tr><td colspan="10" class="empty"><span class="spinner"></span></td></tr>';
      sb.rpc('refresh_n8n_status').then(() => {}, () => {});
      await new Promise(r => setTimeout(r, 150));
      let q = applyFilters(sb.from('leads').select('*', { count: 'exact' }));
      q = q.order(sort.col, { ascending: sort.asc }).order('id', { ascending: false }).range((page - 1) * PER, page * PER - 1);
      const [{ data, count, error }] = await Promise.all([q, chips()]);
      if (error) return fail(error);
      rows = data;
      renderRows(); const pages = Math.max(1, Math.ceil((count || 0) / PER));
      $('#pgInfo').textContent = `${count || 0} lead${count === 1 ? '' : 's'} · page ${page} of ${pages}`;
      $('#pgPrev').disabled = page <= 1; $('#pgNext').disabled = page >= pages;
      $('#checkAll').checked = false; updBulk();
      $('#bulkStatus').innerHTML = STATUSES.map(s => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('');
      refreshNewPill();
      if (api.openAfterLoad) { open(api.openAfterLoad); api.openAfterLoad = null; }
    }

    async function chips() {
      const counts = await Promise.all([sb.from('leads').select('id', { count: 'exact', head: true }),
        ...STATUSES.map(s => sb.from('leads').select('id', { count: 'exact', head: true }).eq('status', s.key))]);
      $('#chips').innerHTML = `<a href="#" data-st="" class="chip ${f.status === '' ? 'on' : ''}">All <b>${counts[0].count || 0}</b></a>` +
        STATUSES.map((s, i) => `<a href="#" data-st="${esc(s.key)}" class="chip ${f.status === s.key ? 'on' : ''}" style="--c:${esc(s.color)}"><i></i>${esc(s.label)} <b>${counts[i + 1].count || 0}</b></a>`).join('');
      $$('#chips a').forEach(a => a.onclick = e => { e.preventDefault(); f.status = a.dataset.st; page = 1; load(); });
    }

    function renderRows() {
      $('#leadRows').innerHTML = rows.length ? rows.map(r => `
        <tr data-id="${r.id}">
          <td class="cb"><input type="checkbox" class="rowcb" value="${r.id}"></td>
          <td><a href="#" class="open"><b>${esc(r.first_name)} ${esc(r.last_name)}</b></a>
            ${r.is_duplicate ? '<span class="tag warn" title="Same email or mobile registered before">duplicate</span>' : ''}
            ${r.notes ? `<span class="tag" title="${esc(r.notes.slice(0, 200))}">note</span>` : ''}</td>
          <td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a><br><a class="muted" href="tel:${esc(r.mobile)}">${esc(fmtMobile(r.mobile))}</a></td>
          <td class="r">${r.seats}</td>
          <td class="muted">${esc(r.super_balance)}</td>
          <td>${esc(sourceLabel(r))}${r.utm_campaign ? `<br><small class="muted">${esc(r.utm_campaign)}</small>` : ''}</td>
          <td>${statusSelect(r.status)}</td>
          <td><span class="n8n n8n-${esc(r.n8n_status)}" title="${esc((r.n8n_code ? 'HTTP ' + r.n8n_code + ' ' : '') + (r.n8n_response || ''))}">${esc(r.n8n_status)}</span></td>
          <td class="nowrap">${esc(fmtDate(r.created_at, { hour: undefined, minute: undefined }))}<br><small class="muted">${esc(fmtDate(r.created_at, { day: undefined, month: undefined, year: undefined }))}</small></td>
          <td><button class="btn sm ghost open">View</button></td>
        </tr>`).join('') : '<tr><td colspan="10" class="empty">No leads found.</td></tr>';

      $$('#leadRows .st-sel').forEach(sel => sel.addEventListener('change', async () => {
        const id = +sel.closest('tr').dataset.id;
        const { error } = await sb.from('leads').update({ status: sel.value }).eq('id', id);
        if (error) return fail(error);
        sel.style.setProperty('--c', statusOf(sel.value).color); toast('Status → ' + statusOf(sel.value).label);
        chips(); refreshNewPill();
      }));
      $$('#leadRows .open').forEach(el => el.addEventListener('click', e => { e.preventDefault(); open(+el.closest('tr').dataset.id); }));
      $$('#leadRows .rowcb').forEach(c => c.addEventListener('change', updBulk));
    }

    const selected = () => $$('.rowcb').filter(c => c.checked).map(c => +c.value);
    function updBulk() { const n = selected().length; $('#bulk').hidden = !n; $('#selN').textContent = n; }
    $('#checkAll').addEventListener('change', e => { $$('.rowcb').forEach(c => c.checked = e.target.checked); updBulk(); });
    $('#bulkApply').onclick = async () => {
      const { error } = await sb.from('leads').update({ status: $('#bulkStatus').value }).in('id', selected());
      error ? fail(error) : (toast('Updated'), load());
    };
    $('#bulkResend').onclick = async () => resend(selected());
    $('#bulkDelete').onclick = async () => {
      const ids = selected(); if (!confirm(`Delete ${ids.length} lead(s) permanently?`)) return;
      const { error } = await sb.from('leads').delete().in('id', ids);
      error ? fail(error) : (toast('Deleted'), load());
    };
    async function resend(ids) {
      toast('Sending to n8n…');
      const { data, error } = await sb.rpc('resend_leads', { p_ids: ids });
      if (error) return fail(error);
      await new Promise(r => setTimeout(r, 2500));
      await sb.rpc('refresh_n8n_status');
      toast(`${data} queued to n8n — check the n8n column`);
      load();
    }

    $('#filters').addEventListener('submit', e => {
      e.preventDefault(); const F = e.target;
      f = { q: F.q.value.trim(), status: f.status, from: F.from.value, to: F.to.value, n8n: F.n8n.value, dup: F.dup.checked }; page = 1; load();
    });
    $('#fReset').onclick = () => { $('#filters').reset(); f = { q: '', status: '', from: '', to: '', n8n: '', dup: false }; page = 1; load(); };
    $('#pgPrev').onclick = () => { page--; load(); };
    $('#pgNext').onclick = () => { page++; load(); };
    $$('[data-sort]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault(); const c = a.dataset.sort;
      sort = { col: c, asc: sort.col === c ? !sort.asc : false }; page = 1; load();
    }));

    // CSV export (all rows matching the filters)
    $('#exportCsv').onclick = async () => {
      toast('Preparing CSV…');
      let all = [], from = 0;
      for (;;) {
        const { data, error } = await applyFilters(sb.from('leads').select('*')).order('id', { ascending: false }).range(from, from + 999);
        if (error) return fail(error);
        all = all.concat(data); if (data.length < 1000) break; from += 1000;
      }
      const head = ['ID', 'Submitted', 'First name', 'Last name', 'Email', 'Mobile', 'Seats', 'Super balance', 'Status', 'Notes', 'Source', 'UTM source', 'UTM medium', 'UTM campaign', 'UTM content', 'UTM term', 'Device', 'Duplicate', 'n8n', 'Referrer', 'Page URL'];
      const cell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const lines = [head.join(',')].concat(all.map(r => [r.id, fmtDate(r.created_at), r.first_name, r.last_name, r.email, r.mobile, r.seats, r.super_balance, statusOf(r.status).label, r.notes,
        sourceLabel(r), r.utm_source, r.utm_medium, r.utm_campaign, r.utm_content, r.utm_term, r.device, r.is_duplicate ? 'yes' : '', r.n8n_status, r.referrer, r.page_url].map(cell).join(',')));
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `leads-${todayLocal()}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };

    /* ---- drawer ---- */
    const drawer = $('#drawer'), bg = $('#drawerBg'), body = $('#dBody');
    const close = () => { drawer.classList.remove('open'); bg.classList.remove('open'); };
    $('#dClose').onclick = close; bg.onclick = close;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const LABELS = { pageview: 'Opened page', cta_click: 'Clicked CTA', form_start: 'Started form', form_submit: 'Submitted form', form_error: 'Form validation error', scroll_50: 'Scrolled 50%', scroll_90: 'Scrolled 90%', engaged_30s: 'Stayed 30s+', lead: 'Became a lead' };

    async function open(id) {
      drawer.classList.add('open'); bg.classList.add('open'); body.innerHTML = '<p class="muted"><span class="spinner"></span> Loading…</p>';
      const { data: L, error } = await sb.from('leads').select('*').eq('id', id).single();
      if (error) { body.innerHTML = '<p>' + esc(error.message) + '</p>'; return; }
      const [act, jr] = await Promise.all([
        sb.from('lead_activity').select('*').eq('lead_id', id).order('id', { ascending: false }).limit(100),
        L.visitor_id ? sb.from('events').select('type,label,created_at').eq('visitor_id', L.visitor_id).order('id').limit(60) : Promise.resolve({ data: [] })]);
      $('#dName').textContent = L.first_name + ' ' + L.last_name;
      const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
      body.innerHTML = `
        <div class="d-actions">${statusSelect(L.status, 'id="dStatus"')}
          <a class="btn sm ghost" href="mailto:${esc(L.email)}">✉ Email</a><a class="btn sm ghost" href="tel:${esc(L.mobile)}">✆ Call</a>
          <a class="btn sm ghost" target="_blank" rel="noopener" href="https://wa.me/61${esc(L.mobile.slice(1))}">WhatsApp</a></div>
        ${L.is_duplicate ? '<div class="alert warn">This email or mobile had registered before.</div>' : ''}
        <dl class="kv">
          ${row('Email', `<a href="mailto:${esc(L.email)}">${esc(L.email)}</a>`)}
          ${row('Mobile', `<a href="tel:${esc(L.mobile)}">${esc(fmtMobile(L.mobile))}</a>`)}
          ${row('Seats', esc(L.seats))}${row('Super balance', esc(L.super_balance))}${row('Submitted', esc(fmtDate(L.created_at)))}
          ${row('Event', esc(L.event_name) + (L.event_date ? `<br><small class="muted">${esc(L.event_date)} · ${esc(L.event_location)}</small>` : ''))}
          ${row('Source', esc(sourceLabel(L)))}
          ${row('Campaign', esc([L.utm_campaign, L.utm_medium, L.utm_content, L.utm_term].filter(Boolean).join(' · ')))}
          ${row('Referrer', esc(L.referrer))}${row('Device', esc(L.device))}
          ${row('n8n', `<span class="n8n n8n-${esc(L.n8n_status)}">${esc(L.n8n_status)}</span> ${L.n8n_code ? 'HTTP ' + esc(L.n8n_code) : ''} <small class="muted">${esc(fmtDate(L.n8n_sent_at))}</small> <button class="btn sm ghost" id="dResend">Resend</button>`)}
        </dl>
        <h4>Notes</h4><textarea id="dNotes" rows="4" placeholder="Call notes, follow-up date…">${esc(L.notes)}</textarea>
        <button class="btn sm" id="dSaveNotes">Save notes</button>
        ${(jr.data || []).length ? `<h4>Visitor journey</h4><ol class="timeline">${jr.data.map(j => `<li><b>${esc(LABELS[j.type] || j.type)}</b>${j.label ? ` <span class="muted">“${esc(j.label)}”</span>` : ''}<small>${esc(fmtDate(j.created_at, { year: undefined, second: '2-digit' }))}</small></li>`).join('')}</ol>` : ''}
        <h4>Activity</h4><ol class="timeline">${(act.data || []).map(a => `<li><b>${esc(a.detail)}</b><small>${esc(fmtDate(a.created_at))} · ${esc(a.username)}</small></li>`).join('')}</ol>
        <button class="btn sm danger" id="dDelete" style="margin-top:18px">Delete lead</button>`;
      $('#dStatus').onchange = async e => {
        const { error } = await sb.from('leads').update({ status: e.target.value }).eq('id', id);
        if (error) return fail(error);
        toast('Status updated'); const tr = $(`tr[data-id="${id}"] .st-sel`);
        if (tr) { tr.value = e.target.value; tr.style.setProperty('--c', statusOf(e.target.value).color); }
        chips(); refreshNewPill(); open(id);
      };
      $('#dSaveNotes').onclick = async () => { const { error } = await sb.from('leads').update({ notes: $('#dNotes').value.slice(0, 5000) }).eq('id', id); error ? fail(error) : toast('Notes saved'); };
      $('#dResend').onclick = async () => { await resend([id]); open(id); };
      $('#dDelete').onclick = async () => { if (!confirm('Delete this lead permanently?')) return; const { error } = await sb.from('leads').delete().eq('id', id); if (error) return fail(error); close(); load(); };
    }
    api.load = load; api.open = open;
    return api;
  })();

  /* ================= SETTINGS ================= */
  const Settings = (function () {
    function render() {
      const fi = $('#fInteg');
      fi.n8n_webhook_url.value = S.n8n_webhook_url || ''; fi.n8n_status_webhook_url.value = S.n8n_status_webhook_url || ''; fi.meta_pixel_id.value = S.meta_pixel_id || '';
      $('#whWarn').hidden = !/\/webhook-test\//.test(S.n8n_webhook_url || '');
      const fg = $('#fGeneral'); fg.timezone.value = TZ(); fg.event_capacity.value = S.event_capacity || 0;
      $('#tzNow').textContent = TZ() + ' — now ' + fmtDate(new Date());
      $('#stRows').innerHTML = ''; STATUSES.forEach(addRow);
      admins();
    }
    function addRow(s) {
      const d = document.createElement('div'); d.className = 'st-row';
      d.innerHTML = `<input type="color" value="${esc(s.color || '#0ea5e9')}"><input class="lbl" value="${esc(s.label || '')}" placeholder="Status name" data-key="${esc(s.key || '')}"><button type="button" class="x">×</button>`;
      d.querySelector('.x').onclick = () => d.remove();
      $('#stRows').appendChild(d); return d;
    }
    $('#addSt').onclick = () => addRow({}).querySelector('.lbl').focus();
    $('#saveSt').onclick = async () => {
      const out = [], seen = {};
      $$('#stRows .st-row').forEach(r => {
        const label = r.querySelector('.lbl').value.trim(); if (!label) return;
        let key = r.querySelector('.lbl').dataset.key || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 's' + out.length;
        if (seen[key]) return; seen[key] = 1;
        out.push({ key, label: label.slice(0, 40), color: r.querySelector('input[type=color]').value });
      });
      if (!seen.new) out.unshift({ key: 'new', label: 'New', color: '#3b82f6' });
      try { await saveSetting('statuses', out); STATUSES = out; toast('Statuses saved'); render(); } catch (e) { fail(e); }
    };
    $('#fInteg').addEventListener('submit', async e => {
      e.preventDefault(); const F = e.target;
      for (const k of ['n8n_webhook_url', 'n8n_status_webhook_url']) {
        const v = F[k].value.trim();
        if (v && !/^https?:\/\/\S+$/i.test(v)) return toast('Invalid URL: ' + v, true);
      }
      try {
        await saveSetting('n8n_webhook_url', F.n8n_webhook_url.value.trim());
        await saveSetting('n8n_status_webhook_url', F.n8n_status_webhook_url.value.trim());
        await saveSetting('meta_pixel_id', F.meta_pixel_id.value.replace(/\D/g, ''));
        toast('Integrations saved'); render();
      } catch (er) { fail(er); }
    });
    $('#fGeneral').addEventListener('submit', async e => {
      e.preventDefault(); const F = e.target;
      try { await saveSetting('timezone', F.timezone.value); await saveSetting('event_capacity', Math.max(0, parseInt(F.event_capacity.value, 10) || 0)); toast('Saved'); render(); } catch (er) { fail(er); }
    });
    $$('[data-test]').forEach(b => b.onclick = async () => {
      const url = (b.dataset.test === 'lead' ? $('#wh1') : $('#wh2')).value.trim();
      if (!/^https?:\/\//i.test(url)) return toast('Enter a valid URL first', true);
      b.disabled = true; b.textContent = 'Sending…';
      const { data: reqId, error } = await sb.rpc('test_webhook', { p_url: url, p_which: b.dataset.test });
      if (error) { b.disabled = false; b.textContent = 'Send test'; return fail(error); }
      let r = null;
      for (let i = 0; i < 12; i++) { await new Promise(x => setTimeout(x, 1000)); const res = await sb.rpc('webhook_result', { p_request_id: reqId }); if (res.data && res.data.done) { r = res.data; break; } }
      b.disabled = false; b.textContent = 'Send test';
      if (!r) return toast('No reply yet from n8n — check the workflow is active', true);
      toast(r.ok ? `n8n replied HTTP ${r.code} ✓` : `Failed: ${r.code ? 'HTTP ' + r.code : ''} ${r.error || (r.body || '').slice(0, 80)}`, !r.ok);
      if (/\/webhook-test\//.test(url)) setTimeout(() => alert('This is a TEST URL — it only works while n8n is "Listening for test event". Use the Production URL (/webhook/) once the workflow is active.'), 400);
    });

    async function admins() {
      const { data, error } = await sb.from('admins').select('*').order('created_at');
      if (error) return fail(error);
      const me = $('#meEmail').textContent.toLowerCase();
      $('#adminRows').innerHTML = data.map(a => `<tr><td>${esc(a.email)}</td><td class="r">${a.email.toLowerCase() === me ? '<span class="muted small">you</span>' : `<button class="btn sm ghost" data-del="${esc(a.email)}">Remove</button>`}</td></tr>`).join('');
      $$('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm('Remove admin access for ' + b.dataset.del + '?')) return;
        const { error } = await sb.from('admins').delete().eq('email', b.dataset.del); error ? fail(error) : admins();
      });
    }
    $('#fAdmin').addEventListener('submit', async e => {
      e.preventDefault();
      const { error } = await sb.from('admins').insert({ email: e.target.email.value.trim().toLowerCase() });
      if (error) return fail(error.code === '23505' ? { message: 'Already an admin' } : error);
      e.target.reset(); toast('Admin added — create their login in Supabase → Authentication → Users'); admins();
    });
    $('#fPass').addEventListener('submit', async e => {
      e.preventDefault(); const F = e.target;
      if (F.p1.value.length < 8) return toast('At least 8 characters', true);
      if (F.p1.value !== F.p2.value) return toast("Passwords don't match", true);
      const { error } = await sb.auth.updateUser({ password: F.p1.value });
      error ? fail(error) : (F.reset(), toast('Password changed'));
    });
    $('#resetAn').onclick = async () => {
      if (prompt('Type RESET to delete all visit & click analytics:') !== 'RESET') return;
      const { error } = await sb.rpc('reset_analytics'); error ? fail(error) : toast('Analytics cleared');
    };
    return { render };
  })();

  boot().catch(fail);
})();
