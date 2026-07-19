// @ts-check
// Pannello codice con lista virtualizzata (regge file da centinaia di migliaia
// di righe), evidenziazione sintassi G-code, ricerca con navigazione match
// e sincronizzazione bidirezionale con il viewer.

const LINE_H = 19;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// lettera indirizzo → classe colore (stile NCnetic)
const ADDR_CLASS = {
  G: 't-g', M: 't-m', N: 't-n', O: 't-n',
  X: 't-xyz', Y: 't-xyz', Z: 't-xyz', I: 't-xyz', J: 't-xyz', K: 't-xyz',
  U: 't-xyz', V: 't-xyz', W: 't-xyz', A: 't-xyz', B: 't-xyz', C: 't-xyz', R: 't-xyz',
  F: 't-fs', S: 't-fs', P: 't-fs', Q: 't-fs',
  T: 't-tool', D: 't-tool', H: 't-tool',
};

/** Evidenzia una riga G-code restituendo HTML. */
function highlightGcode(raw) {
  let out = '';
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const c = raw[i];
    if (c === '(') {                       // commento tra parentesi
      const j = raw.indexOf(')', i);
      const end = j < 0 ? n : j + 1;
      out += `<span class="t-cm">${esc(raw.slice(i, end))}</span>`;
      i = end; continue;
    }
    if (c === ';' || c === '%') {           // commento a fine riga / delimitatore
      out += `<span class="t-cm">${esc(raw.slice(i))}</span>`;
      break;
    }
    // indirizzo + valore numerico (anche con spazio, es. "X 10.5")
    const m = /^([A-Za-z])([ \t]*[-+]?(?:\d+\.?\d*|\.\d+))/.exec(raw.slice(i));
    if (m) {
      const cls = ADDR_CLASS[m[1].toUpperCase()];
      out += cls ? `<span class="${cls}">${esc(m[0])}</span>` : esc(m[0]);
      i += m[0].length; continue;
    }
    out += esc(c); i++;
  }
  return out;
}

/**
 * @param {{scroll:HTMLElement, spacer:HTMLElement, view:HTMLElement}} els
 * @param {{onSelectLine?: (line:number)=>void}} cb
 */
export function createCodePanel(els, cb = {}) {
  const { scroll, spacer, view } = els;
  let lines = /** @type {string[]} */ ([]);
  let geoLines = new Set();
  let selected = -1;
  let active = -1;
  let running = -1;   // riga in esecuzione durante la simulazione
  let lang = 'plain';
  // ricerca
  let query = '';
  let matches = /** @type {number[]} */ ([]);   // righe (1-based) che contengono la query
  let matchCur = -1;                             // indice in matches
  let onSearch = /** @type {((n:number, total:number)=>void)|null} */ (null);

  function fmt(i) {
    const txt = lines[i];
    return lang === 'gcode' ? highlightGcode(txt) : esc(txt);
  }

  function render() {
    const first = Math.max(0, Math.floor(scroll.scrollTop / LINE_H) - 5);
    const last = Math.min(lines.length, first + Math.ceil(scroll.clientHeight / LINE_H) + 10);
    const matchSet = query ? new Set(matches) : null;
    const curLine = matchCur >= 0 ? matches[matchCur] : -1;
    let html = '';
    for (let i = first; i < last; i++) {
      const l = i + 1;
      const cls = ['row'];
      if (geoLines.has(l)) cls.push('geo');
      if (l === selected) cls.push('sel');
      else if (l === active) cls.push('act');
      if (l === running) cls.push('run');
      if (matchSet && matchSet.has(l)) cls.push(l === curLine ? 'match-cur' : 'match');
      html += `<div class="${cls.join(' ')}" style="top:${i * LINE_H}px" data-l="${l}">` +
              `<span class="ln">${l}</span><span class="tx">${fmt(i)}</span></div>`;
    }
    view.innerHTML = html;
  }

  scroll.addEventListener('scroll', render);
  new ResizeObserver(render).observe(scroll);

  view.addEventListener('click', (e) => {
    const row = /** @type {HTMLElement} */ (e.target instanceof HTMLElement && e.target.closest('.row'));
    if (!row) return;
    const l = Number(row.dataset.l);
    selected = l;
    render();
    cb.onSelectLine && cb.onSelectLine(l);
  });

  function scrollTo(line) {
    const y = (line - 1) * LINE_H;
    if (y < scroll.scrollTop + LINE_H || y > scroll.scrollTop + scroll.clientHeight - LINE_H * 2) {
      scroll.scrollTop = Math.max(0, y - scroll.clientHeight / 2);
    }
  }

  function runSearch(q) {
    query = q || '';
    matches = [];
    matchCur = -1;
    if (query) {
      const needle = query.toLowerCase();
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) matches.push(i + 1);
      }
      if (matches.length) { matchCur = 0; scrollTo(matches[0]); }
    }
    onSearch && onSearch(matches.length ? matchCur + 1 : 0, matches.length);
    render();
  }

  function step(dir) {
    if (!matches.length) return;
    matchCur = (matchCur + dir + matches.length) % matches.length;
    scrollTo(matches[matchCur]);
    onSearch && onSearch(matchCur + 1, matches.length);
    render();
  }

  return {
    /** @param {string[]} newLines @param {Set<number>} geo @param {string} [language] */
    setLines(newLines, geo, language = 'plain') {
      lines = newLines;
      geoLines = geo;
      lang = language;
      selected = -1;
      active = -1;
      running = -1;
      query = ''; matches = []; matchCur = -1;
      spacer.style.height = `${lines.length * LINE_H}px`;
      scroll.scrollTop = 0;
      render();
    },
    select(line, doScroll = true) {
      selected = line;
      if (doScroll && line > 0) scrollTo(line);
      render();
    },
    setActive(line) {
      if (line === active) return;
      active = line;
      render();
    },
    /** Evidenzia (e tiene in vista) la riga in esecuzione nella simulazione; -1 = spegni. */
    follow(line) {
      if (line === running) return;
      running = line;
      if (line > 0) scrollTo(line);
      render();
    },
    search: runSearch,
    searchNext: () => step(1),
    searchPrev: () => step(-1),
    onSearchUpdate(fn) { onSearch = fn; },
  };
}
