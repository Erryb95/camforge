// @ts-check
// Pannello informazioni: file, ingombri, lunghezze, utensili (con toggle), avvisi.

import { TOOL_COLORS } from '../render/viewer2d.js';

/**
 * @param {HTMLElement} container
 * @param {{onToolToggle?:(hidden:Set<number>)=>void, onWarningClick?:(line:number)=>void}} cb
 */
export function createStatsPanel(container, cb = {}) {
  const hidden = new Set();

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const f1 = (n) => n.toLocaleString('it-IT', { maximumFractionDigits: 1 });
  const f2 = (n) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 });

  function fmtTime(min) {
    const s = Math.round(min * 60);
    const m = Math.floor(s / 60);
    return m >= 60
      ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
      : `${m}m ${String(s % 60).padStart(2, '0')}s`;
  }

  /** @param {import('../core/model.js').SceneModel|null} model */
  function update(model) {
    hidden.clear();
    if (!model) { container.innerHTML = '<div class="empty-note">Nessun file caricato.</div>'; return; }

    const b = model.bounds, bf = model.boundsFeed;
    const dim = (bb, ax) => bb ? `${f2(bb.min[ax])} … ${f2(bb.max[ax])} (Δ ${f2(bb.max[ax] - bb.min[ax])})` : '—';

    let html = `
      <div class="info-sec"><h3>File</h3><div class="kv">
        <span class="k">Nome</span><span class="v">${esc(model.name || '—')}</span>
        <span class="k">Programma</span><span class="v">${esc(model.program || '—')}</span>
        <span class="k">Unità file</span><span class="v">${model.units === 'in' ? 'pollici → mm' : 'mm'}</span>
        <span class="k">Righe</span><span class="v">${model.rawLines.length}</span>
        <span class="k">Segmenti</span><span class="v">${model.segments.length}</span>
        <span class="k">Fori</span><span class="v">${model.drillPoints.length}</span>
      </div></div>
      <div class="info-sec"><h3>Ingombro lavorato (mm)</h3><div class="kv">
        <span class="k">X</span><span class="v">${dim(bf, 'x')}</span>
        <span class="k">Y</span><span class="v">${dim(bf, 'y')}</span>
        <span class="k">Z</span><span class="v">${dim(bf, 'z')}</span>
      </div></div>
      <div class="info-sec"><h3>Percorso</h3><div class="kv">
        <span class="k">In lavoro</span><span class="v">${f1(model.stats.feedLen)} mm</span>
        <span class="k">In rapido</span><span class="v">${f1(model.stats.rapidLen)} mm</span>
        <span class="k">Tempo lavoro</span><span class="v">${model.stats.timeMin !== null ? '≈ ' + fmtTime(model.stats.timeMin) : 'n/d'}</span>
      </div></div>`;

    // utensili
    html += '<div class="info-sec"><h3>Utensili</h3>';
    if (model.stats.tools.length === 0) {
      html += '<div class="empty-note">Nessun cambio utensile (T/M6) nel programma.</div>';
    } else {
      for (let i = 0; i < model.stats.tools.length; i++) {
        const t = model.stats.tools[i];
        const color = TOOL_COLORS[i % TOOL_COLORS.length];
        const count = model.segments.filter((s) => s.tool === t && s.type !== 'rapid').length;
        html += `<label class="tool-row"><input type="checkbox" checked data-tool="${t}">
          <span class="tool-chip" style="background:${color}"></span>T${t}
          <span class="cnt">${count} seg</span></label>`;
      }
    }
    html += '</div>';

    // avvisi
    html += `<div class="info-sec"><h3>Avvisi (${model.warnings.length})</h3>`;
    if (model.warnings.length === 0) {
      html += '<div class="empty-note">Nessun avviso: programma interpretato completamente.</div>';
    } else {
      for (const wr of model.warnings.slice(0, 200)) {
        html += `<div class="warn-row" data-line="${wr.line}"><span class="wl">r.${wr.line}</span>${esc(wr.msg)}</div>`;
      }
      if (model.warnings.length > 200) {
        html += `<div class="empty-note">… e altri ${model.warnings.length - 200} avvisi</div>`;
      }
    }
    html += '</div>';

    container.innerHTML = html;

    container.querySelectorAll('input[data-tool]').forEach((el) => {
      el.addEventListener('change', () => {
        const t = Number(/** @type {HTMLElement} */(el).dataset.tool);
        if (/** @type {HTMLInputElement} */(el).checked) hidden.delete(t);
        else hidden.add(t);
        cb.onToolToggle && cb.onToolToggle(new Set(hidden));
      });
    });
    container.querySelectorAll('.warn-row').forEach((el) => {
      el.addEventListener('click', () => {
        cb.onWarningClick && cb.onWarningClick(Number(/** @type {HTMLElement} */(el).dataset.line));
      });
    });
  }

  update(null);
  return { update };
}
