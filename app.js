'use strict';
(() => {
  // ---------- Storage (IndexedDB, with localStorage fallback) ----------
  const DB_NAME = 'filament-inventory';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no idb'));
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('spools')) d.createObjectStore('spools', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        if (!d.objectStoreNames.contains('prints')) d.createObjectStore('prints', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function run(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const req = fn(t.objectStore(storeName));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const LS = 'filament-inventory-v1';
  const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
  const lsWrite = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} };

  function makeCollection(name) {
    return {
      async all() {
        if (db) return run(name, 'readonly', s => s.getAll());
        return lsRead()[name] || [];
      },
      async putMany(list) {
        if (db) return new Promise((resolve, reject) => {
          const t = db.transaction(name, 'readwrite');
          const s = t.objectStore(name);
          list.forEach(x => s.put(x));
          t.oncomplete = resolve; t.onerror = () => reject(t.error);
        });
        const o = lsRead(); const map = new Map((o[name] || []).map(x => [x.id, x]));
        list.forEach(x => map.set(x.id, x)); o[name] = [...map.values()]; lsWrite(o);
      },
      async remove(id) {
        if (db) return run(name, 'readwrite', s => s.delete(id));
        const o = lsRead(); o[name] = (o[name] || []).filter(x => x.id !== id); lsWrite(o);
      },
      async clear() {
        if (db) return run(name, 'readwrite', s => s.clear());
        const o = lsRead(); o[name] = []; lsWrite(o);
      },
    };
  }
  const spoolsDB = makeCollection('spools');
  const printsDB = makeCollection('prints');
  const meta = {
    async get(k) {
      if (db) return run('meta', 'readonly', s => s.get(k));
      return (lsRead().meta || {})[k];
    },
    async set(k, v) {
      if (db) return run('meta', 'readwrite', s => s.put(v, k));
      const o = lsRead(); o.meta = o.meta || {}; o.meta[k] = v; lsWrite(o);
    },
  };

  // ---------- Constants ----------
  const MATERIALS = ['PLA', 'PLA+', 'PLA Pro', 'PLA Silk', 'PLA Matte', 'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'Nylon', 'PVA', 'HIPS', 'CF Composite', 'Other'];
  const DRYING = ['', 'Dry', 'Needs drying', 'Drying now', 'Sealed / new'];
  const RAINBOW = 'conic-gradient(#ff5a5a, #ffbe46, #f2e94e, #5ad278, #5096ff, #aa6eff, #ff5a5a)';
  // Color families: name, swatch used on the filter chip
  const FAMILIES = [
    ['White', '#f4f4f1'], ['Black', '#1b1b1d'], ['Gray', '#8a8f98'], ['Red', '#d93a3a'],
    ['Orange', '#f08a24'], ['Yellow', '#f2cc2e'], ['Green', '#2f9e55'], ['Blue', '#2f6fe0'],
    ['Purple', '#8b5cf6'], ['Pink', '#ec6fb0'], ['Beige/Brown', '#a7845a'], ['Clear', 'transparent'], ['Multi', RAINBOW],
  ];
  const FAMILY_ORDER = Object.fromEntries(FAMILIES.map(([n], i) => [n, i]));
  const NAME_HINTS = [
    [/rainbow|gradient|multi|celestial|tri[- ]?colou?r|dual[- ]?colou?r|galaxy|aurora/, 'Multi'],
    [/clear|transparent|translucent|natural/, 'Clear'],
    [/beige|tan\b|wood|brown|bronze|coffee|chocolate|khaki|sand|caramel/, 'Beige/Brown'],
    [/white|ivory|bone|snow/, 'White'],
    [/black|onyx|charcoal|midnight/, 'Black'],
    [/gr[ae]y|silver|ash|slate|titan/, 'Gray'],
    [/pink|magenta|rose|fuchsia|sakura/, 'Pink'],
    [/purple|violet|lavender|lilac|plum/, 'Purple'],
    [/blue|navy|cyan|teal|turquoise|sky|cobalt|aqua/, 'Blue'],
    [/green|lime|olive|mint|emerald|jade/, 'Green'],
    [/yellow|gold|lemon|mustard/, 'Yellow'],
    [/orange|copper|amber|peach/, 'Orange'],
    [/red|crimson|scarlet|maroon|burgundy/, 'Red'],
  ];

  function hexFamily(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 'Gray';
    const n = parseInt(m[1], 16); const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    if (l > 0.88 && s < 0.35) return 'White';
    if (l < 0.14) return 'Black';
    if (s < 0.15) return l > 0.75 ? 'White' : 'Gray';
    if (h < 15 || h >= 345) return l < 0.3 ? 'Beige/Brown' : 'Red';
    if (h < 45) return l < 0.45 || s < 0.45 ? 'Beige/Brown' : 'Orange';
    if (h < 65) return l < 0.35 ? 'Beige/Brown' : 'Yellow';
    if (h < 165) return 'Green';
    if (h < 255) return 'Blue';
    if (h < 290) return 'Purple';
    return 'Pink';
  }
  function family(s) {
    if (s.colorFamily && s.colorFamily !== 'auto') return s.colorFamily;
    const name = `${s.color || ''} ${s.line || ''}`.toLowerCase();
    for (const [re, fam] of NAME_HINTS) if (re.test(name)) return fam;
    return hexFamily(s.hex);
  }

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
  const state = { spools: [], prints: [], threshold: 150, q: '', material: '', color: '', lowOnly: false, sort: 'added' };

  // ---------- Helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 0) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : d; };
  const round1 = (n) => Math.round(n * 10) / 10;
  const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const grams = (g) => g >= 10000 ? (g / 1000).toFixed(1) + ' kg' : Math.round(g).toLocaleString() + ' g';
  const fmtG = (g) => (Math.round(g * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' g';
  const title = (s) => [s.brand, s.line].filter(Boolean).join(' ') || 'Unnamed spool';
  const isLow = (s) => s.remainingG <= state.threshold;
  const validHex = (h) => /^#[0-9a-f]{6}$/i.test(h || '') ? h : '#888888';
  const swatchBg = (s) => family(s) === 'Multi' && !(s.colorFamily && s.colorFamily !== 'auto' && s.colorFamily !== 'Multi') ? RAINBOW : validHex(s.hex);
  const perGram = (s) => (s.price === '' || s.price == null) ? 0 : num(s.price) / (s.sizeG || 1000);
  const spoolById = (id) => state.spools.find(x => x.id === id);

  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2200);
  }

  function barHTML(s) {
    const pct = Math.max(0, Math.min(100, (s.remainingG / (s.sizeG || 1000)) * 100));
    const cls = isLow(s) ? 'low' : pct < 50 ? 'mid' : '';
    return `<div class="bar ${cls}"><i style="width:${pct.toFixed(1)}%"></i></div>`;
  }

  // ---------- Rendering ----------
  function filtered() {
    const q = state.q.trim().toLowerCase();
    const list = state.spools
      .filter(s => !state.material || s.material === state.material)
      .filter(s => !state.color || family(s) === state.color)
      .filter(s => !state.lowOnly || isLow(s))
      .filter(s => !q || [s.brand, s.line, s.material, s.color, family(s), s.location, s.notes, s.hex].join(' ').toLowerCase().includes(q));
    const byName = (a, b) => title(a).localeCompare(title(b)) || (a.color || '').localeCompare(b.color || '');
    const sorters = {
      added: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
      low: (a, b) => a.remainingG - b.remainingG,
      high: (a, b) => b.remainingG - a.remainingG,
      color: (a, b) => (FAMILY_ORDER[family(a)] - FAMILY_ORDER[family(b)]) || byName(a, b),
      material: (a, b) => (a.material || '').localeCompare(b.material || '') || byName(a, b),
    };
    return list.sort(sorters[state.sort] || sorters.added);
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
    const mats = [...new Set(state.spools.map(s => s.material).filter(Boolean))].sort();
    const fams = [...new Set(state.spools.map(family))].sort((a, b) => FAMILY_ORDER[a] - FAMILY_ORDER[b]);
    if (state.material && !mats.includes(state.material)) state.material = '';
    if (state.color && !fams.includes(state.color)) state.color = '';
    const count = (pred) => state.spools.filter(pred).length;
    const lowN = count(isLow);

    $('#f-material').innerHTML =
      `<button class="chip" data-mat="" aria-pressed="${!state.material}">All types</button>` +
      mats.map(m => `<button class="chip" data-mat="${esc(m)}" aria-pressed="${m === state.material}">${esc(m)} <small>${count(s => s.material === m)}</small></button>`).join('') +
      `<button class="chip low-chip" data-low aria-pressed="${state.lowOnly}">Low ≤${state.threshold}g <small>${lowN}</small></button>`;

    $('#f-color').innerHTML =
      `<button class="chip" data-col="" aria-pressed="${!state.color}">All colors</button>` +
      fams.map(f => {
        const sw = FAMILIES.find(x => x[0] === f)[1];
        return `<button class="chip" data-col="${f}" aria-pressed="${f === state.color}"><i class="dot ${f === 'Clear' ? 'clear' : ''}" style="background:${sw}"></i>${f} <small>${count(s => family(s) === f)}</small></button>`;
      }).join('');
  }

  function render() {
    renderFilters();
    const list = filtered();
    renderStats(list);
    const el = $('#list');
    if (!list.length) {
      el.innerHTML = `<div class="empty">${state.spools.length ? 'No spools match these filters.' : 'No spools yet. Tap “+ Spool” to add one.'}</div>`;
      return;
    }
    el.innerHTML = list.map(s => `
      <button class="spool" data-id="${esc(s.id)}">
        <div class="swatch" style="background:${swatchBg(s)}"></div>
        <div class="spool-body">
          <div class="name">${esc(s.color || 'No color')} <span class="mat">${esc(s.material || '')}</span></div>
          <div class="sub">${esc([title(s), s.location].filter(Boolean).join(' · '))}</div>
          ${barHTML(s)}
          <div class="wt"><span>${fmtG(s.remainingG).replace(' g', '')} / ${s.sizeG.toLocaleString()} g</span>${isLow(s) ? '<span class="low-tag">Low</span>' : ''}</div>
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

  // ---------- Usage log ----------
  async function logUsage(name, items) {
    // items: [{spoolId, g}] -> subtract, record a print entry
    const merged = new Map();
    items.forEach(it => merged.set(it.spoolId, (merged.get(it.spoolId) || 0) + it.g));
    const changed = []; const entryItems = []; let cost = 0;
    for (const [id, g] of merged) {
      const s = spoolById(id); if (!s) continue;
      const before = s.remainingG;
      s.remainingG = Math.max(0, round1(before - g));
      s.updatedAt = Date.now(); s.lastUsedAt = Date.now();
      cost += g * perGram(s);
      changed.push(s);
      entryItems.push({ spoolId: id, g: round1(g), before, label: `${s.color || ''} · ${title(s)}`, hex: s.hex, bg: swatchBg(s) });
    }
    if (!changed.length) return null;
    const entry = { id: uid(), at: Date.now(), name: name || '', items: entryItems, cost: Math.round(cost * 100) / 100 };
    await spoolsDB.putMany(changed);
    await printsDB.putMany([entry]);
    state.prints.push(entry);
    render();
    return entry;
  }

  async function undoPrint(entry) {
    const changed = [];
    for (const it of entry.items) {
      const s = spoolById(it.spoolId); if (!s) continue;
      s.remainingG = round1(s.remainingG + it.g); s.updatedAt = Date.now();
      changed.push(s);
    }
    await spoolsDB.putMany(changed);
    await printsDB.remove(entry.id);
    state.prints = state.prints.filter(p => p.id !== entry.id);
    render();
  }

  // ---------- Detail ----------
  function showDetail(id) {
    const s = spoolById(id);
    if (!s) return closeSheet();
    const usedG = state.prints.reduce((a, p) => a + p.items.filter(i => i.spoolId === s.id).reduce((b, i) => b + i.g, 0), 0);
    const rows = [
      ['Brand', s.brand], ['Product line', s.line],
      ['Material', s.material], ['Color', s.color], ['Color group', family(s)], ['Hex', s.hex],
      ['Spool size', s.sizeG + ' g'], ['Price paid', s.price !== '' && s.price != null ? money(num(s.price)) : ''],
      ['Value left', perGram(s) ? money(perGram(s) * s.remainingG) : ''],
      ['Logged usage', usedG ? fmtG(usedG) : ''],
      ['Location', s.location], ['Purchased', s.purchaseDate], ['Drying', s.drying],
      ['Nozzle temp', s.nozzleTemp ? s.nozzleTemp + ' °C' : ''], ['Bed temp', s.bedTemp ? s.bedTemp + ' °C' : ''],
      ['Notes', s.notes],
    ].filter(([, v]) => v !== '' && v != null);

    openSheet(`
      <div class="sheet-head"><h2>Spool</h2><button class="btn" data-act="close">Done</button></div>
      <div class="detail-top">
        <div class="swatch lg" style="background:${swatchBg(s)}"></div>
        <div><div class="name">${esc(s.color || 'No color')}</div><div class="sub">${esc(title(s))} · ${esc(s.material || '')}</div></div>
      </div>
      <div class="big-wt">${fmtG(s.remainingG)} <span class="hint">of ${s.sizeG} g${isLow(s) ? ' · low' : ''}</span></div>
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
      const used = async (g) => {
        if (!(g > 0)) return toast('Enter grams used');
        await logUsage('Quick use', [{ spoolId: s.id, g }]);
        showDetail(s.id); toast(`−${fmtG(g)} → ${fmtG(s.remainingG)} left`);
      };
      el.querySelector('[data-form=used]').addEventListener('submit', e => { e.preventDefault(); used(num(e.target.g.value, NaN)); });
      el.querySelectorAll('[data-used]').forEach(b => b.addEventListener('click', () => used(num(b.dataset.used))));
      el.querySelector('[data-form=set]').addEventListener('submit', async e => {
        e.preventDefault(); const g = num(e.target.g.value, NaN);
        if (!(g >= 0)) return toast('Enter grams remaining');
        s.remainingG = round1(g); s.updatedAt = Date.now();
        await spoolsDB.putMany([s]); render(); showDetail(s.id); toast(`Set to ${fmtG(g)}`);
      });
      el.querySelector('[data-act=edit]').onclick = () => showForm(s);
      el.querySelector('[data-act=dup]').onclick = () => showForm({ ...s, id: null, remainingG: s.sizeG, purchaseDate: today() });
      el.querySelector('[data-act=delete]').onclick = async () => {
        if (!confirm(`Delete "${s.color} – ${title(s)}"?`)) return;
        await spoolsDB.remove(s.id);
        state.spools = state.spools.filter(x => x.id !== s.id);
        closeSheet(); render(); toast('Spool deleted');
      };
    });
  }

  // ---------- Add / Edit form ----------
  function showForm(existing) {
    const isEdit = !!(existing && existing.id);
    const s = existing || { brand: '', line: '', material: 'PLA', color: '', hex: '#888888', colorFamily: 'auto', sizeG: 1000, price: '', remainingG: '', location: '', purchaseDate: today(), notes: '', drying: '', nozzleTemp: '', bedTemp: '' };
    const brands = [...new Set(state.spools.map(x => x.brand).filter(Boolean))];
    const locs = [...new Set(state.spools.map(x => x.location).filter(Boolean))];
    const mats = [...new Set([...MATERIALS, ...state.spools.map(x => x.material).filter(Boolean)])];
    const curFam = s.colorFamily || 'auto';
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
          ${f('colorFamily', 'Color group', `<select id="i-colorFamily" name="colorFamily"><option value="auto" ${curFam === 'auto' ? 'selected' : ''}>Auto</option>${FAMILIES.map(([n]) => `<option ${n === curFam ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}
          ${f('sizeG', 'Spool size (g)', inp('sizeG', 'number', 'inputmode="numeric" min="1" step="1" required'))}
          ${f('price', 'Price paid ($ each)', inp('price', 'number', 'inputmode="decimal" min="0" step="0.01"'))}
          ${f('remainingG', 'Remaining (g)', inp('remainingG', 'number', 'inputmode="decimal" min="0" step="any" placeholder="Full"'))}
          ${f('location', 'Storage location', inp('location', 'text', 'list="dl-locs"'))}
          ${f('purchaseDate', 'Purchase date', inp('purchaseDate', 'date'), !isEdit)}
          ${isEdit ? '' : f('qty', 'Quantity', `<input id="i-qty" name="qty" type="number" inputmode="numeric" min="1" max="100" step="1" value="1">`)}
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
          hex: validHex(fd.hex), colorFamily: fd.colorFamily || 'auto', sizeG, price: fd.price === '' ? '' : num(fd.price),
          remainingG: rem, location: fd.location.trim(), purchaseDate: fd.purchaseDate,
          notes: fd.notes.trim(), drying: fd.drying, nozzleTemp: fd.nozzleTemp, bedTemp: fd.bedTemp,
          updatedAt: Date.now(),
        };
        if (isEdit) {
          Object.assign(s, data);
          await spoolsDB.putMany([s]);
          render(); showDetail(s.id); toast('Saved');
        } else {
          const qty = Math.min(100, Math.max(1, Math.floor(num(fd.qty, 1))));
          let t = Date.now();
          const created = Array.from({ length: qty }, () => ({ ...data, id: uid(), createdAt: t++ }));
          await spoolsDB.putMany(created);
          state.spools.push(...created);
          closeSheet(); render(); toast(qty > 1 ? `Added ${qty} spools` : 'Spool added');
        }
      });
    });
  }

  // ---------- Slicer photo reading (on-device OCR) ----------
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let tessLoading = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (!tessLoading) tessLoading = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = TESS_URL; sc.async = true;
      sc.onload = resolve;
      sc.onerror = () => { tessLoading = null; sc.remove(); reject(new Error('Couldn’t load the text reader. The first photo needs an internet connection.')); };
      document.head.appendChild(sc);
    });
    return tessLoading;
  }

  async function prepImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const w0 = img.naturalWidth, h0 = img.naturalHeight;
      // Upscale small screenshots, downscale huge photos
      const scale = Math.min(3, 2000 / w0, 3000 / Math.max(w0, h0));
      const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h); const px = d.data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const invert = sum / (px.length / 4) < 120; // dark-mode slicer -> make it black on white
      for (let i = 0; i < px.length; i += 4) {
        let y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (invert) y = 255 - y;
        y = Math.max(0, Math.min(255, (y - 128) * 1.4 + 128)); // contrast boost
        px[i] = px[i + 1] = px[i + 2] = y;
      }
      ctx.putImageData(d, 0, 0);
      // White margin helps the reader find text that touches the edge
      const pad = 24, out = document.createElement('canvas');
      out.width = w + pad * 2; out.height = h + pad * 2;
      const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(c, pad, pad);
      return out;
    } finally { URL.revokeObjectURL(url); }
  }

  // OCR commonly misreads "g" as "9" or "¢": "192.079" -> "192.07 g", "22.48¢" -> "22.48 g"
  function fixOcr(line) {
    return line
      .replace(/[¢§]/g, 'g')
      .replace(/g{2,}/g, 'g')
      .replace(/(\d+[.,]\d{2})9(?![\d.,])/g, '$1 g')
      .replace(/(\d)\s*[gq](?=\s|$)/g, '$1 g');
  }

  // Turns OCR text into per-filament gram amounts.
  // Bambu/Orca: a filament row is "64.40 m 7.54 m 71.94 m" then "192.07 g 22.48 g 214.55 g"
  // (Model, Support, Total) — the last g on a line with several values is that filament's total.
  function parseUsage(text) {
    const NUM = '(\\d{1,5}(?:[.,]\\d{1,3})?)';
    const results = [];
    const lines = text.split(/\r?\n/).map(l => fixOcr(l.trim())).filter(Boolean);
    for (const line of lines) {
      const vals = [];
      const raw = []; // [value, hadDecimal]
      let m; const re = new RegExp(NUM + '\\s?(kg|g)(?![a-z])', 'gi');
      while ((m = re.exec(line))) raw.push([num(m[1]) * (m[2].toLowerCase() === 'kg' ? 1000 : 1), /[.,]/.test(m[1])]);
      const re2 = new RegExp('\\(g\\)\\s*[:=]?\\s*' + NUM, 'gi'); // PrusaSlicer "Used filament (g): 12.34"
      while ((m = re2.exec(line))) raw.push([num(m[1]), /[.,]/.test(m[1])]);
      // Slicer tables print 2 decimals; a value that lost its point ("21455 g") is really 214.55
      const anyDecimal = raw.some(r => r[1]);
      const good = raw.map(([g, dec]) => (anyDecimal && !dec && g >= 100 && raw.length > 1) ? g / 100 : g).filter(g => g > 0 && g < 20000);
      if (!good.length) continue;
      const isSum = /^(total|sum)\b/i.test(line) && results.length > 0;
      results.push({ g: Math.round(good[good.length - 1] * 100) / 100, parts: good.length > 1 ? good.slice(0, -1) : [], line, isSum });
    }
    // Drop a grand-total line if it equals the sum of the filament lines
    const filaments = results.filter(r => !r.isSum);
    const sumF = filaments.reduce((a, r) => a + r.g, 0);
    return results.filter(r => !r.isSum || Math.abs(r.g - sumF) > 0.6).map((r, i) => ({ ...r, label: r.isSum ? 'Total' : `Filament ${i + 1}` }));
  }

  let worker = null, progressCb = () => {};
  async function getWorker() {
    await loadTesseract();
    if (!worker) {
      worker = await window.Tesseract.createWorker('eng', 1, {
        logger: m => { if (m.status === 'recognizing text') progressCb('Reading numbers…', m.progress); else progressCb('Loading text reader…', 0); },
      });
    }
    return worker;
  }
  // Allow-list keeps the reader from inventing symbols like "¢" in place of "g"
  const OCR_CHARS = '0123456789.,:()<>/-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ';

  async function readSlicerPhoto(file, onProgress) {
    progressCb = onProgress;
    onProgress('Loading text reader…', 0);
    const w = await getWorker();
    const canvas = await prepImage(file);
    // Pass 1: read as rows (keeps Model / Support / Total on one line). Pass 2: automatic layout.
    let text = '', found = [];
    for (const psm of ['6', '3']) {
      onProgress('Reading numbers…', 0);
      await w.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: OCR_CHARS, preserve_interword_spaces: '1' });
      const res = await w.recognize(canvas);
      text = res.data.text; found = parseUsage(text);
      if (found.length) break;
    }
    return { text, found };
  }

  // ---------- Log a print ----------
  function spoolOptionsHTML(selectedId) {
    const sorted = [...state.spools].sort((a, b) =>
      (FAMILY_ORDER[family(a)] - FAMILY_ORDER[family(b)]) || title(a).localeCompare(title(b)) || a.remainingG - b.remainingG);
    return `<option value="">Choose spool…</option>` + sorted.map(s =>
      `<option value="${esc(s.id)}" ${s.id === selectedId ? 'selected' : ''}>${esc(s.color || 'No color')} · ${esc(title(s))} (${Math.round(s.remainingG)} g)</option>`).join('');
  }

  function showLogPrint() {
    // Row: { spoolId, g, parts: [model, support] | null (when read from a photo) }
    const rows = [{ spoolId: lastUsedSpoolId(), g: '', parts: null }];
    let photoUrl = '', rawText = '';

    openSheet(`
      <div class="sheet-head">
        <button type="button" class="btn" data-act="close">Cancel</button>
        <h2>Log a print</h2>
        <button class="btn primary" data-act="apply">Apply</button>
      </div>
      <div class="field"><label for="i-pname">Print name (optional)</label><input id="i-pname" type="text" placeholder="e.g. Benchy, phone stand" autocapitalize="sentences"></div>

      <label class="photo-btn">
        <input type="file" id="i-photo" accept="image/*" hidden>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <span id="photo-label">Photo or screenshot of slicer estimate</span>
      </label>
      <div id="ocr" class="ocr" hidden>
        <button type="button" class="ocr-thumb" id="ocr-zoom" aria-label="Enlarge photo"><img id="ocr-img" alt="Slicer estimate"></button>
        <div class="ocr-side">
          <div id="ocr-status" class="hint"></div>
          <div class="progress"><i id="ocr-bar"></i></div>
        </div>
      </div>
      <div id="review-note" class="review-note" hidden>
        <b>Check these numbers against your photo.</b>
        <span>Tap the photo to enlarge it. Fix any misread value; the total updates as you type.</span>
      </div>

      <div class="section-label">Filament used</div>
      <div id="rows" class="rows"></div>
      <button class="btn block" data-act="addrow">+ Add another spool</button>
      <div id="summary" class="summary"></div>
      <details id="raw" class="raw" hidden><summary>What the reader saw</summary><pre id="raw-text"></pre></details>
    `, (el) => {
      const rowsEl = el.querySelector('#rows');
      const r2 = (n) => Math.round(n * 100) / 100;

      function partsCheck(r) {
        if (!r.parts) return '';
        const sum = r2(r.parts.reduce((a, b) => a + num(b), 0));
        const ok = Math.abs(sum - num(r.g)) <= 0.05;
        return `<div class="parts">
          <label>Model (g)<input data-part="0" type="number" inputmode="decimal" step="any" value="${esc(r.parts[0])}"></label>
          <label>Support (g)<input data-part="1" type="number" inputmode="decimal" step="any" value="${esc(r.parts[1])}"></label>
          <span class="check ${ok ? 'ok' : 'neg'}">${ok ? `Model + Support = ${sum} g ✓` : `Model + Support = ${sum} g, but total says ${r2(num(r.g))} g. Check the photo.`}</span>
        </div>`;
      }
      function rowSub(r) {
        const s = spoolById(r.spoolId); const g = num(r.g, 0);
        if (!s) return '<span class="hint">Pick the spool this filament came from</span>';
        if (!(g > 0)) return `<span class="hint">${fmtG(s.remainingG)} on spool</span>`;
        const after = s.remainingG - g;
        const cost = g * perGram(s);
        return `<span>${fmtG(s.remainingG)} → <b class="${after < 0 ? 'neg' : after <= state.threshold ? 'warn' : ''}">${fmtG(Math.max(0, after))}</b> left</span>` +
          `${cost ? `<span class="hint">${money(cost)}</span>` : ''}` +
          `${after < 0 ? `<span class="neg">Short ${fmtG(-after)}</span>` : ''}`;
      }
      function rowHTML(r, i) {
        const s = spoolById(r.spoolId);
        return `<div class="prow ${r.parts ? 'from-photo' : ''}" data-i="${i}">
          ${r.parts ? `<div class="prow-title">Filament ${i + 1} · read from photo</div>` : ''}
          <div class="swatch sm" style="background:${s ? swatchBg(s) : 'var(--card-2)'}"></div>
          <select data-k="spoolId" aria-label="Spool">${spoolOptionsHTML(r.spoolId)}</select>
          <button class="x" data-del="${i}" aria-label="Remove row">×</button>
          <label class="gline">${r.parts ? 'Total used' : 'Grams used'}<span class="gwrap"><input data-k="g" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${esc(r.g)}"> g</span></label>
          <div class="prow-wide">${partsCheck(r)}</div>
          <div class="prow-sub">${rowSub(r)}</div>
        </div>`;
      }
      function renderRows() {
        rowsEl.innerHTML = rows.map(rowHTML).join('');
        renderSummary();
      }
      function refreshRow(rowEl, r, skipParts) {
        if (!skipParts) {
          const wide = rowEl.querySelector('.prow-wide');
          // Only refresh the check text so inputs keep focus
          const chk = wide.querySelector('.check');
          if (chk) {
            const sum = r2(r.parts.reduce((a, b) => a + num(b), 0));
            const ok = Math.abs(sum - num(r.g)) <= 0.05;
            chk.className = 'check ' + (ok ? 'ok' : 'neg');
            chk.textContent = ok ? `Model + Support = ${sum} g ✓` : `Model + Support = ${sum} g, but total says ${r2(num(r.g))} g. Check the photo.`;
          }
        }
        rowEl.querySelector('.prow-sub').innerHTML = rowSub(r);
        renderSummary();
      }
      function renderSummary() {
        const valid = rows.filter(r => spoolById(r.spoolId) && num(r.g) > 0);
        const total = valid.reduce((a, r) => a + num(r.g), 0);
        const cost = valid.reduce((a, r) => a + num(r.g) * perGram(spoolById(r.spoolId)), 0);
        el.querySelector('#summary').innerHTML = valid.length
          ? `<b>${fmtG(total)}</b> from ${valid.length} spool${valid.length > 1 ? 's' : ''}${cost ? ` · about <b>${money(cost)}</b> of filament` : ''}`
          : '';
      }

      rowsEl.addEventListener('change', e => {
        const row = e.target.closest('.prow'); if (!row) return;
        if (e.target.dataset.k === 'spoolId') { rows[+row.dataset.i].spoolId = e.target.value; renderRows(); }
      });
      rowsEl.addEventListener('input', e => {
        const row = e.target.closest('.prow'); if (!row) return;
        const r = rows[+row.dataset.i];
        if (e.target.dataset.k === 'g') { r.g = e.target.value; refreshRow(row, r); }
        else if (e.target.dataset.part != null) {
          r.parts[+e.target.dataset.part] = e.target.value;
          r.g = r2(r.parts.reduce((a, b) => a + num(b), 0));
          row.querySelector('[data-k=g]').value = r.g;
          refreshRow(row, r);
        }
      });
      rowsEl.addEventListener('click', e => {
        const b = e.target.closest('[data-del]'); if (!b) return;
        rows.splice(+b.dataset.del, 1); if (!rows.length) rows.push({ spoolId: '', g: '', parts: null });
        renderRows();
      });
      el.querySelector('[data-act=addrow]').onclick = () => { rows.push({ spoolId: '', g: '', parts: null }); renderRows(); };

      // Tap the thumbnail to see the photo full width for comparing numbers
      el.querySelector('#ocr-zoom').onclick = () => el.querySelector('#ocr').classList.toggle('big');

      el.querySelector('#i-photo').addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        e.target.value = '';
        const box = el.querySelector('#ocr'), img = el.querySelector('#ocr-img');
        const status = el.querySelector('#ocr-status'), bar = el.querySelector('#ocr-bar');
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        photoUrl = URL.createObjectURL(file);
        box.hidden = false; box.classList.remove('big'); img.src = photoUrl;
        el.querySelector('#photo-label').textContent = 'Use a different photo';
        bar.parentElement.hidden = false;
        try {
          const res = await readSlicerPhoto(file, (msg, p) => { status.textContent = msg; bar.style.width = Math.round(p * 100) + '%'; });
          rawText = res.text;
          el.querySelector('#raw').hidden = !rawText.trim();
          el.querySelector('#raw-text').textContent = rawText;
          bar.parentElement.hidden = true;
          const fil = res.found.filter(f => f.label !== 'Total');
          const use = fil.length ? fil : res.found;
          if (!use.length) {
            status.textContent = 'No gram amounts found. Type the grams below, or try a closer, sharper shot of the filament table.';
            return;
          }
          status.textContent = use.length === 1 ? `Read ${use[0].g} g used.` : `Read ${use.length} filament amounts.`;
          // One row per filament; keep spools already chosen in existing rows
          use.forEach((f, i) => {
            const parts = f.parts.length === 2 ? f.parts.map(r2) : null;
            if (rows[i]) Object.assign(rows[i], { g: f.g, parts });
            else rows.push({ spoolId: '', g: f.g, parts });
          });
          el.querySelector('#review-note').hidden = false;
          renderRows();
        } catch (err) {
          bar.parentElement.hidden = true;
          status.textContent = err.message || 'Couldn’t read that image. Type the grams below.';
        }
      });

      el.querySelector('[data-act=apply]').onclick = async () => {
        const valid = rows.filter(r => spoolById(r.spoolId) && num(r.g) > 0);
        if (rows.some(r => num(r.g) > 0 && !spoolById(r.spoolId))) return toast('Pick a spool for each amount');
        if (!valid.length) return toast('Add grams and a spool first');
        const name = el.querySelector('#i-pname').value.trim();
        const entry = await logUsage(name, valid.map(r => ({ spoolId: r.spoolId, g: num(r.g) })));
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        closeSheet();
        const total = entry.items.reduce((a, i) => a + i.g, 0);
        toast(`Logged ${fmtG(total)}${entry.cost ? ` · ${money(entry.cost)}` : ''}`);
      };

      renderRows();
    });
  }

  function lastUsedSpoolId() {
    const s = [...state.spools].filter(x => x.lastUsedAt).sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    return s ? s.id : '';
  }

  // ---------- History ----------
  function showHistory() {
    const list = [...state.prints].sort((a, b) => b.at - a.at);
    const totalG = list.reduce((a, p) => a + p.items.reduce((b, i) => b + i.g, 0), 0);
    const totalCost = list.reduce((a, p) => a + (p.cost || 0), 0);
    const when = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    openSheet(`
      <div class="sheet-head"><h2>Print history</h2><button class="btn" data-act="close">Done</button></div>
      ${list.length ? `<p class="hint">${list.length} entries · ${fmtG(totalG)} used${totalCost ? ` · ${money(totalCost)}` : ''}</p>` : ''}
      <div class="history">
        ${list.length ? list.map(p => `
          <div class="hcard">
            <div class="hhead"><b>${esc(p.name || 'Print')}</b><span class="hint">${when(p.at)}</span></div>
            ${p.items.map(i => {
              const s = spoolById(i.spoolId);
              return `<div class="hitem"><i class="dot" style="background:${s ? swatchBg(s) : (i.bg || validHex(i.hex))}"></i><span>${esc(s ? `${s.color} · ${title(s)}` : i.label + ' (deleted)')}</span><b>−${fmtG(i.g)}</b></div>`;
            }).join('')}
            <div class="hfoot"><span class="hint">${p.cost ? money(p.cost) : ''}</span><button class="btn small" data-undo="${esc(p.id)}">Undo</button></div>
          </div>`).join('') : '<div class="empty">No prints logged yet. Use “Log a print” after slicing.</div>'}
      </div>
    `, (el) => {
      el.querySelectorAll('[data-undo]').forEach(b => b.onclick = async () => {
        const p = state.prints.find(x => x.id === b.dataset.undo); if (!p) return;
        if (!confirm(`Undo "${p.name || 'Print'}"? Its grams go back on the spools.`)) return;
        await undoPrint(p); showHistory(); toast('Undone, grams restored');
      });
    });
  }

  // ---------- Settings / backup ----------
  async function showSettings() {
    const lastBackup = await meta.get('lastBackup');
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
        <p class="hint">Last backup: ${lastBackup ? new Date(lastBackup).toLocaleDateString() : 'never'}. Data is stored only on this phone. Deleting the home-screen app or clearing Safari data erases it, so export now and then.</p>
      </div>
      <div class="section-label" style="margin-top:24px">Danger zone</div>
      <div class="stack"><button class="btn danger block" data-act="wipe">Delete all spools and history</button></div>
      <p class="hint" style="margin-top:16px">${state.spools.length} spools · ${state.prints.length} log entries · storage: ${db ? 'IndexedDB' : 'localStorage'}</p>
    `, (el) => {
      el.querySelector('#thr-form').addEventListener('submit', async e => {
        e.preventDefault();
        state.threshold = Math.max(0, Math.round(num($('#i-thr').value, 150)));
        await meta.set('threshold', state.threshold); render(); toast(`Low stock ≤ ${state.threshold} g`);
      });
      el.querySelector('[data-act=export]').onclick = exportJSON;
      const file = el.querySelector('#import-file');
      el.querySelector('[data-act=import]').onclick = () => file.click();
      file.onchange = () => file.files[0] && importJSON(file.files[0]);
      el.querySelector('[data-act=wipe]').onclick = async () => {
        if (!confirm('Delete ALL spools and print history? Export a backup first if unsure.')) return;
        await spoolsDB.clear(); await printsDB.clear(); state.spools = []; state.prints = [];
        render(); closeSheet(); toast('Everything deleted');
      };
    });
  }

  async function exportJSON() {
    const payload = { app: 'filament-inventory', version: 2, exportedAt: new Date().toISOString(), threshold: state.threshold, spools: state.spools, prints: state.prints };
    const json = JSON.stringify(payload, null, 2);
    const name = `filament-backup-${today()}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const done = () => meta.set('lastBackup', Date.now());
    try {
      const fileObj = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
        await navigator.share({ files: [fileObj], title: name });
        await done(); return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    await done();
  }

  async function importJSON(file) {
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.spools;
      if (!Array.isArray(list)) throw new Error('No spools array');
      const replace = confirm(`Import ${list.length} spools.\n\nOK = replace current inventory\nCancel = merge (keep existing, update matching)`);
      let t = Date.now();
      const clean = list.map(s => ({
        brand: '', line: '', material: 'PLA', color: '', location: '', purchaseDate: '', notes: '', drying: '', nozzleTemp: '', bedTemp: '', price: '', colorFamily: 'auto',
        ...s,
        id: s.id || uid(), hex: validHex(s.hex), sizeG: num(s.sizeG, 1000), remainingG: num(s.remainingG, num(s.sizeG, 1000)),
        createdAt: s.createdAt || t++,
      }));
      if (replace) { await spoolsDB.clear(); if (Array.isArray(data.prints)) await printsDB.clear(); }
      await spoolsDB.putMany(clean);
      if (Array.isArray(data.prints)) await printsDB.putMany(data.prints.filter(p => p && p.id && Array.isArray(p.items)));
      if (data.threshold != null) { state.threshold = num(data.threshold, 150); await meta.set('threshold', state.threshold); }
      state.spools = await spoolsDB.all();
      state.prints = await printsDB.all();
      render(); closeSheet(); toast(`Imported ${clean.length} spools`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  }

  // ---------- Events ----------
  function bind() {
    $('#list').addEventListener('click', e => { const b = e.target.closest('.spool'); if (b) showDetail(b.dataset.id); });
    $('#btn-add').onclick = () => showForm(null);
    $('#btn-log').onclick = showLogPrint;
    $('#btn-history').onclick = showHistory;
    $('#btn-settings').onclick = showSettings;
    $('#search').addEventListener('input', e => { state.q = e.target.value; render(); });
    $('#sort').onchange = e => { state.sort = e.target.value; meta.set('sort', state.sort); render(); };
    $('#f-material').addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      if ('low' in b.dataset) state.lowOnly = !state.lowOnly;
      else state.material = b.dataset.mat === state.material ? '' : b.dataset.mat;
      render();
    });
    $('#f-color').addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      state.color = b.dataset.col === state.color ? '' : b.dataset.col;
      render();
    });
    $('#overlay .backdrop').onclick = closeSheet;
    $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-act=close]')) closeSheet(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#overlay').hidden) closeSheet(); });
  }

  // ---------- Service worker + auto-update ----------
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // A new version took over: reload once so the new files are used (skip on first install)
      if (!hadController || reloaded) return;
      if (!$('#overlay').hidden) return; // don't yank the page while a sheet is open
      reloaded = true; location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  // ---------- Init ----------
  async function init() {
    try { db = await openDB(); } catch { db = null; }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
    const seeded = await meta.get('seeded');
    if (!seeded) {
      await spoolsDB.putMany(seedSpools());
      await meta.set('seeded', true);
    }
    const thr = await meta.get('threshold');
    if (thr != null) state.threshold = thr;
    const sort = await meta.get('sort');
    if (sort) { state.sort = sort; $('#sort').value = sort; }
    state.spools = await spoolsDB.all();
    state.prints = await printsDB.all();
    bind(); render();
    registerSW();
    window.__filament = { parseUsage, readSlicerPhoto, state }; // handy for debugging
  }
  init();
})();
