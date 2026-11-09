'use strict';
(() => {
  // ---------- Storage (IndexedDB, with localStorage fallback) ----------
  const DB_NAME = 'filament-inventory';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no idb'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('spools')) d.createObjectStore('spools', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function run(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const LS = 'filament-inventory-v1';
  const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
  const lsWrite = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} };

  const store = {
    async all() {
      if (db) return run('spools', 'readonly', s => s.getAll());
      return lsRead().spools || [];
    },
    async putMany(list) {
      if (db) return new Promise((resolve, reject) => {
        const t = db.transaction('spools', 'readwrite');
        const s = t.objectStore('spools');
        list.forEach(x => s.put(x));
        t.oncomplete = resolve; t.onerror = () => reject(t.error);
      });
      const o = lsRead(); const map = new Map((o.spools || []).map(x => [x.id, x]));
      list.forEach(x => map.set(x.id, x)); o.spools = [...map.values()]; lsWrite(o);
    },
    async remove(id) {
      if (db) return run('spools', 'readwrite', s => s.delete(id));
      const o = lsRead(); o.spools = (o.spools || []).filter(x => x.id !== id); lsWrite(o);
    },
    async clear() {
      if (db) return run('spools', 'readwrite', s => s.clear());
      const o = lsRead(); o.spools = []; lsWrite(o);
    },
    async getMeta(k) {
      if (db) return run('meta', 'readonly', s => s.get(k));
      return (lsRead().meta || {})[k];
    },
    async setMeta(k, v) {
      if (db) return run('meta', 'readwrite', s => s.put(v, k));
      const o = lsRead(); o.meta = o.meta || {}; o.meta[k] = v; lsWrite(o);
    },
  };

  // ---------- Constants ----------
  const MATERIALS = ['PLA', 'PLA+', 'PLA Pro', 'PLA Silk', 'PLA Matte', 'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'Nylon', 'PVA', 'HIPS', 'CF Composite', 'Other'];
  const DRYING = ['', 'Dry', 'Needs drying', 'Drying now', 'Sealed / new'];

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const today = () => new Date().toISOString().slice(0, 10);

  function seedSpools() {
    const base = { sizeG: 1000, location: '', purchaseDate: '', notes: '', drying: '', nozzleTemp: '', bedTemp: '' };
    const rows = [
      { brand: 'Polymaker', line: 'PolySonic PLA', material: 'PLA', color: 'White', hex: '#f4f4f1', price: 8.25, qty: 2, notes: '$16.50 for the pair' },
      { brand: 'Polymaker', line: 'Panchroma Gradient Celestial', material: 'PLA', color: 'Celestial Rainbow', hex: '#8b6cf0', price: 12.36, qty: 1 },
      { brand: 'Polymaker', line: 'PolyLite PLA Pro', material: 'PLA Pro', color: 'Green', hex: '#2f9e55', price: 9.89, qty: 1 },
      { brand: 'Polymaker', line: 'Panchroma Matte PLA', material: 'PLA Matte', color: 'Matte Pastel Beige', hex: '#e2d3b8', price: 8.25, qty: 1 },
      { brand: 'Anycubic', line: 'PLA', material: 'PLA', color: 'Black', hex: '#1b1b1d', price: 11.25, qty: 2, notes: 'Bought on Amazon ($22.50 for the pair)' },
    ];
    const out = []; let t = Date.now();
    for (const r of rows) {
      const { qty, ...rest } = r;
      for (let i = 0; i < qty; i++) out.push({ ...base, ...rest, id: uid(), remainingG: 1000, createdAt: t++ });
    }
    return out;
  }

  // ---------- State ----------
  const state = { spools: [], threshold: 150, q: '', material: '', brand: '', lowOnly: false };

  // ---------- Helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const grams = (g) => g >= 10000 ? (g / 1000).toFixed(1) + ' kg' : Math.round(g).toLocaleString() + ' g';
  const title = (s) => [s.brand, s.line].filter(Boolean).join(' ') || 'Unnamed spool';
  const isLow = (s) => s.remainingG <= state.threshold;
  const validHex = (h) => /^#[0-9a-f]{6}$/i.test(h || '') ? h : '#888888';

  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2000);
  }

  function barHTML(s) {
    const pct = Math.max(0, Math.min(100, (s.remainingG / (s.sizeG || 1000)) * 100));
    const cls = isLow(s) ? 'low' : pct < 50 ? 'mid' : '';
    return `<div class="bar ${cls}"><i style="width:${pct.toFixed(1)}%"></i></div>`;
  }

  // ---------- Rendering ----------
  function filtered() {
    const q = state.q.trim().toLowerCase();
    return state.spools
      .filter(s => !state.material || s.material === state.material)
      .filter(s => !state.brand || s.brand === state.brand)
      .filter(s => !state.lowOnly || isLow(s))
      .filter(s => !q || [s.brand, s.line, s.material, s.color, s.location, s.notes, s.hex].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function renderStats(list) {
    const total = list.reduce((a, s) => a + num(s.remainingG), 0);
    const spent = list.reduce((a, s) => a + num(s.price), 0);
    const filteredNote = list.length !== state.spools.length;
    $('#stats').innerHTML = `
      <div class="stat"><b>${list.length}</b><span>${filteredNote ? 'shown' : 'spools'}</span></div>
      <div class="stat"><b>${grams(total)}</b><span>on hand</span></div>
      <div class="stat"><b>${money(spent)}</b><span>spent</span></div>`;
  }

  function renderFilters() {
    const mats = [...new Set([...state.spools.map(s => s.material).filter(Boolean)])].sort();
    const brands = [...new Set(state.spools.map(s => s.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (state.material && !mats.includes(state.material)) state.material = '';
    if (state.brand && !brands.includes(state.brand)) state.brand = '';
    $('#f-material').innerHTML = `<option value="">All materials</option>` + mats.map(m => `<option ${m === state.material ? 'selected' : ''}>${esc(m)}</option>`).join('');
    $('#f-brand').innerHTML = `<option value="">All brands</option>` + brands.map(b => `<option ${b === state.brand ? 'selected' : ''}>${esc(b)}</option>`).join('');
    const low = $('#f-low');
    low.setAttribute('aria-pressed', String(state.lowOnly));
    low.textContent = `Low ≤${state.threshold}g`;
  }

  function render() {
    renderFilters();
    const list = filtered();
    renderStats(list);
    const el = $('#list');
    if (!list.length) {
      el.innerHTML = `<div class="empty">${state.spools.length ? 'No spools match.' : 'No spools yet. Tap + to add one.'}</div>`;
      return;
    }
    el.innerHTML = list.map(s => `
      <button class="spool" data-id="${esc(s.id)}">
        <div class="swatch" style="background:${validHex(s.hex)}"></div>
        <div>
          <div class="name">${esc(title(s))}</div>
          <div class="sub">${esc([s.color, s.material, s.location].filter(Boolean).join(' · '))}</div>
          ${barHTML(s)}
          <div class="wt"><span>${Math.round(s.remainingG)} / ${s.sizeG} g</span>${isLow(s) ? '<span class="low-tag">Low</span>' : ''}</div>
        </div>
      </button>`).join('');
  }

  // ---------- Sheet ----------
  function openSheet(html, onMount) {
    const sheet = $('#sheet');
    sheet.innerHTML = html;
    $('#overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    sheet.scrollTop = 0;
    onMount && onMount(sheet);
  }
  function closeSheet() {
    $('#overlay').hidden = true;
    document.body.style.overflow = '';
    $('#sheet').innerHTML = '';
  }

  // ---------- Detail ----------
  function showDetail(id) {
    const s = state.spools.find(x => x.id === id);
    if (!s) return closeSheet();
    const rows = [
      ['Material', s.material], ['Color', s.color], ['Hex', s.hex],
      ['Spool size', s.sizeG + ' g'], ['Price paid', s.price !== '' && s.price != null ? money(num(s.price)) : ''],
      ['Location', s.location], ['Purchased', s.purchaseDate], ['Drying', s.drying],
      ['Nozzle temp', s.nozzleTemp ? s.nozzleTemp + ' °C' : ''], ['Bed temp', s.bedTemp ? s.bedTemp + ' °C' : ''],
      ['Notes', s.notes],
    ].filter(([, v]) => v !== '' && v != null);

    openSheet(`
      <div class="sheet-head"><h2>Spool</h2><button class="btn" data-act="close">Done</button></div>
      <div class="detail-top">
        <div class="swatch lg" style="background:${validHex(s.hex)}"></div>
        <div><div class="name">${esc(title(s))}</div><div class="sub">${esc(s.color || '')}</div></div>
      </div>
      <div class="big-wt">${Math.round(s.remainingG)} g <span class="hint">of ${s.sizeG} g${isLow(s) ? ' · low' : ''}</span></div>
      ${barHTML(s)}

      <form class="qa" data-form="used">
        <input name="g" type="number" inputmode="decimal" min="0" step="any" placeholder="Used (g)" aria-label="Grams used">
        <button class="btn primary">Used X g</button>
      </form>
      <div class="quick-chips">
        ${[10, 25, 50, 100].map(g => `<button class="chip" data-used="${g}">−${g} g</button>`).join('')}
      </div>
      <form class="qa" data-form="set">
        <input name="g" type="number" inputmode="decimal" min="0" step="any" placeholder="Remaining (g)" aria-label="Grams remaining">
        <button class="btn">Set remaining</button>
      </form>

      <dl class="kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>

      <div class="row-btns">
        <button class="btn" data-act="edit">Edit</button>
        <button class="btn" data-act="dup">Duplicate</button>
      </div>
      <div class="stack"><button class="btn danger block" data-act="delete">Delete spool</button></div>
    `, (el) => {
      const apply = async (newG, msg) => {
        s.remainingG = Math.max(0, Math.round(newG * 10) / 10);
        s.updatedAt = Date.now();
        await store.putMany([s]); render(); showDetail(s.id); toast(msg);
      };
      el.querySelector('[data-form=used]').addEventListener('submit', e => {
        e.preventDefault(); const g = num(e.target.g.value, NaN);
        if (!(g > 0)) return toast('Enter grams used');
        apply(s.remainingG - g, `−${g} g → ${Math.round(Math.max(0, s.remainingG - g))} g left`);
      });
      el.querySelector('[data-form=set]').addEventListener('submit', e => {
        e.preventDefault(); const g = num(e.target.g.value, NaN);
        if (!(g >= 0)) return toast('Enter grams remaining');
        apply(g, `Set to ${Math.round(g)} g`);
      });
      el.querySelectorAll('[data-used]').forEach(b => b.addEventListener('click', () => {
        const g = num(b.dataset.used); apply(s.remainingG - g, `−${g} g → ${Math.round(Math.max(0, s.remainingG - g))} g left`);
      }));
      el.querySelector('[data-act=edit]').onclick = () => showForm(s);
      el.querySelector('[data-act=dup]').onclick = () => showForm({ ...s, id: null, remainingG: s.sizeG, purchaseDate: today() });
      el.querySelector('[data-act=delete]').onclick = async () => {
        if (!confirm(`Delete "${title(s)} – ${s.color}"?`)) return;
        await store.remove(s.id);
        state.spools = state.spools.filter(x => x.id !== s.id);
        closeSheet(); render(); toast('Spool deleted');
      };
    });
  }

  // ---------- Add / Edit form ----------
  function showForm(existing) {
    const isEdit = !!(existing && existing.id);
    const s = existing || { brand: '', line: '', material: 'PLA', color: '', hex: '#888888', sizeG: 1000, price: '', remainingG: '', location: '', purchaseDate: today(), notes: '', drying: '', nozzleTemp: '', bedTemp: '' };
    const brands = [...new Set(state.spools.map(x => x.brand).filter(Boolean))];
    const locs = [...new Set(state.spools.map(x => x.location).filter(Boolean))];
    const mats = [...new Set([...MATERIALS, ...state.spools.map(x => x.material).filter(Boolean)])];
    const f = (name, label, input, full) => `<div class="field ${full ? 'full' : ''}"><label for="i-${name}">${label}</label>${input}</div>`;
    const inp = (name, type = 'text', extra = '') => `<input id="i-${name}" name="${name}" type="${type}" value="${esc(s[name])}" ${extra}>`;

    openSheet(`
      <form id="spool-form">
        <div class="sheet-head">
          <button type="button" class="btn" data-act="cancel">Cancel</button>
          <h2>${isEdit ? 'Edit spool' : 'Add spool'}</h2>
          <button class="btn primary">Save</button>
        </div>
        <div class="form">
          ${f('brand', 'Brand', inp('brand', 'text', 'list="dl-brands" autocapitalize="words" required'))}
          ${f('line', 'Product line', inp('line', 'text', 'autocapitalize="words"'))}
          ${f('material', 'Material', `<select id="i-material" name="material">${mats.map(m => `<option ${m === s.material ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`)}
          ${f('color', 'Color name', inp('color', 'text', 'autocapitalize="words"'))}
          ${f('hex', 'Swatch', inp('hex', 'color'))}
          ${f('sizeG', 'Spool size (g)', inp('sizeG', 'number', 'inputmode="numeric" min="1" step="1" required'))}
          ${f('price', 'Price paid ($ each)', inp('price', 'number', 'inputmode="decimal" min="0" step="0.01"'))}
          ${f('remainingG', 'Remaining (g)', inp('remainingG', 'number', 'inputmode="decimal" min="0" step="any" placeholder="Full"'))}
          ${f('location', 'Storage location', inp('location', 'text', 'list="dl-locs"'))}
          ${f('purchaseDate', 'Purchase date', inp('purchaseDate', 'date'))}
          ${isEdit ? '' : f('qty', 'Quantity (identical spools)', `<input id="i-qty" name="qty" type="number" inputmode="numeric" min="1" max="100" step="1" value="1">`, true)}
          ${f('notes', 'Notes', `<textarea id="i-notes" name="notes">${esc(s.notes)}</textarea>`, true)}
          <div class="section-label">Optional</div>
          ${f('drying', 'Drying status', `<select id="i-drying" name="drying">${DRYING.map(d => `<option value="${esc(d)}" ${d === (s.drying || '') ? 'selected' : ''}>${d || '—'}</option>`).join('')}</select>`, true)}
          ${f('nozzleTemp', 'Nozzle temp (°C)', inp('nozzleTemp', 'number', 'inputmode="numeric" min="0" step="1"'))}
          ${f('bedTemp', 'Bed temp (°C)', inp('bedTemp', 'number', 'inputmode="numeric" min="0" step="1"'))}
        </div>
        <datalist id="dl-brands">${brands.map(b => `<option value="${esc(b)}">`).join('')}</datalist>
        <datalist id="dl-locs">${locs.map(b => `<option value="${esc(b)}">`).join('')}</datalist>
      </form>
    `, (el) => {
      el.querySelector('[data-act=cancel]').onclick = () => (isEdit ? showDetail(s.id) : closeSheet());
      el.querySelector('#spool-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        const sizeG = Math.max(1, num(fd.sizeG, 1000));
        const rem = fd.remainingG === '' ? sizeG : Math.max(0, num(fd.remainingG, sizeG));
        const data = {
          brand: fd.brand.trim(), line: fd.line.trim(), material: fd.material, color: fd.color.trim(),
          hex: validHex(fd.hex), sizeG, price: fd.price === '' ? '' : num(fd.price),
          remainingG: rem, location: fd.location.trim(), purchaseDate: fd.purchaseDate,
          notes: fd.notes.trim(), drying: fd.drying, nozzleTemp: fd.nozzleTemp, bedTemp: fd.bedTemp,
          updatedAt: Date.now(),
        };
        if (isEdit) {
          Object.assign(s, data);
          await store.putMany([s]);
          render(); showDetail(s.id); toast('Saved');
        } else {
          const qty = Math.min(100, Math.max(1, Math.floor(num(fd.qty, 1))));
          let t = Date.now();
          const created = Array.from({ length: qty }, () => ({ ...data, id: uid(), createdAt: t++ }));
          await store.putMany(created);
          state.spools.push(...created);
          closeSheet(); render(); toast(qty > 1 ? `Added ${qty} spools` : 'Spool added');
        }
      });
    });
  }

  // ---------- Settings / backup ----------
  function showSettings() {
    openSheet(`
      <div class="sheet-head"><h2>Settings</h2><button class="btn" data-act="close">Done</button></div>
      <form class="stack" id="thr-form">
        <div class="field"><label for="i-thr">Low-stock threshold (g)</label>
          <input id="i-thr" type="number" inputmode="numeric" min="0" step="1" value="${state.threshold}"></div>
        <button class="btn primary block">Save threshold</button>
      </form>
      <div class="section-label" style="margin-top:24px">Backup</div>
      <div class="stack">
        <button class="btn block" data-act="export">Export JSON backup</button>
        <button class="btn block" data-act="import">Import JSON backup…</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
        <p class="hint">Data is stored only on this device, in this browser. Export regularly — deleting the home-screen app or clearing Safari data erases it.</p>
      </div>
      <div class="section-label" style="margin-top:24px">Danger zone</div>
      <div class="stack"><button class="btn danger block" data-act="wipe">Delete all spools</button></div>
      <p class="hint" style="margin-top:16px">${state.spools.length} spools · storage: ${db ? 'IndexedDB' : 'localStorage'}</p>
    `, (el) => {
      el.querySelector('#thr-form').addEventListener('submit', async e => {
        e.preventDefault();
        state.threshold = Math.max(0, Math.round(num($('#i-thr').value, 150)));
        await store.setMeta('threshold', state.threshold); render(); toast(`Low stock ≤ ${state.threshold} g`);
      });
      el.querySelector('[data-act=export]').onclick = exportJSON;
      const file = el.querySelector('#import-file');
      el.querySelector('[data-act=import]').onclick = () => file.click();
      file.onchange = () => file.files[0] && importJSON(file.files[0]);
      el.querySelector('[data-act=wipe]').onclick = async () => {
        if (!confirm('Delete ALL spools? Export a backup first if unsure.')) return;
        await store.clear(); state.spools = []; render(); closeSheet(); toast('All spools deleted');
      };
    });
  }

  async function exportJSON() {
    const payload = { app: 'filament-inventory', version: 1, exportedAt: new Date().toISOString(), threshold: state.threshold, spools: state.spools };
    const json = JSON.stringify(payload, null, 2);
    const name = `filament-backup-${today()}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    try {
      const fileObj = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
        await navigator.share({ files: [fileObj], title: name });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function importJSON(file) {
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.spools;
      if (!Array.isArray(list)) throw new Error('No spools array');
      const replace = confirm(`Import ${list.length} spools.\n\nOK = replace current inventory\nCancel = merge (keep existing, update matching)`);
      let t = Date.now();
      const clean = list.map(s => ({
        brand: '', line: '', material: 'PLA', color: '', location: '', purchaseDate: '', notes: '', drying: '', nozzleTemp: '', bedTemp: '', price: '',
        ...s,
        id: s.id || uid(), hex: validHex(s.hex), sizeG: num(s.sizeG, 1000), remainingG: num(s.remainingG, num(s.sizeG, 1000)),
        createdAt: s.createdAt || t++,
      }));
      if (replace) await store.clear();
      await store.putMany(clean);
      if (data.threshold != null) { state.threshold = num(data.threshold, 150); await store.setMeta('threshold', state.threshold); }
      state.spools = await store.all();
      render(); closeSheet(); toast(`Imported ${clean.length} spools`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  }

  // ---------- Events ----------
  function bind() {
    $('#list').addEventListener('click', e => { const b = e.target.closest('.spool'); if (b) showDetail(b.dataset.id); });
    $('#btn-add').onclick = () => showForm(null);
    $('#btn-settings').onclick = showSettings;
    $('#search').addEventListener('input', e => { state.q = e.target.value; render(); });
    $('#f-material').onchange = e => { state.material = e.target.value; render(); };
    $('#f-brand').onchange = e => { state.brand = e.target.value; render(); };
    $('#f-low').onclick = () => { state.lowOnly = !state.lowOnly; render(); };
    $('#overlay .backdrop').onclick = closeSheet;
    $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-act=close]')) closeSheet(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#overlay').hidden) closeSheet(); });
  }

  // ---------- Init ----------
  async function init() {
    try { db = await openDB(); } catch { db = null; }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
    const seeded = await store.getMeta('seeded');
    if (!seeded) {
      await store.putMany(seedSpools());
      await store.setMeta('seeded', true);
    }
    const thr = await store.getMeta('threshold');
    if (thr != null) state.threshold = thr;
    state.spools = await store.all();
    bind(); render();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  init();
})();
