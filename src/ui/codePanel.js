// @ts-check
// Pannello codice con lista virtualizzata (regge file da centinaia di migliaia di righe)
// e sincronizzazione bidirezionale con il viewer.

const LINE_H = 19;

/**
 * @param {{scroll:HTMLElement, spacer:HTMLElement, view:HTMLElement}} els
 * @param {{onSelectLine?: (line:number)=>void}} cb
 */
export function createCodePanel(els, cb = {}) {
  const { scroll, spacer, view } = els;
  let lines = /** @type {string[]} */ ([]);
  let geoLines = new Set();     // righe che generano geometria (cliccabili)
  let selected = -1;            // riga selezionata (click su segmento o su riga)
  let active = -1;              // riga evidenziata da hover

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function render() {
    const first = Math.max(0, Math.floor(scroll.scrollTop / LINE_H) - 5);
    const last = Math.min(lines.length, first + Math.ceil(scroll.clientHeight / LINE_H) + 10);
    let html = '';
    for (let i = first; i < last; i++) {
      const l = i + 1;
      const cls = ['row'];
      if (geoLines.has(l)) cls.push('geo');
      if (l === selected) cls.push('sel');
      else if (l === active) cls.push('act');
      html += `<div class="${cls.join(' ')}" style="top:${i * LINE_H}px" data-l="${l}">` +
              `<span class="ln">${l}</span><span class="tx">${esc(lines[i])}</span></div>`;
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

  return {
    /** @param {string[]} newLines @param {Set<number>} geo */
    setLines(newLines, geo) {
      lines = newLines;
      geoLines = geo;
      selected = -1;
      active = -1;
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
  };
}
