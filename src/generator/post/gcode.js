// @ts-check
// POST-PROCESSOR G-code standard (2D laser/plasma) — adattato dai post
// ufficiali FreeCAD CAM (LGPL-2.1-or-later, copie in vendor/reference/
// freecad-posts/): grbl_post.py (preamble/postamble/ordine parametri),
// linuxcnc_post.py (preamble sicurezza), generic_plasma_post.py (semantica
// M3/M5 = sorgente ON/OFF e PIERCE DELAY ~70 ms/mm, minimo 500 ms).
//
// Prende il toolpath IR di ../toolpath.js e produce il programma NC.

/**
 * @typedef {import('../toolpath.js').CutOp} CutOp
 * @typedef {{
 *   dialect?:'grbl'|'linuxcnc',
 *   feed?:number,          // mm/min
 *   power?:number,         // S (0-1000 tipico grbl)
 *   thickness?:number,     // mm, per il pierce delay
 *   pierceMs?:number,      // override delay
 *   name?:string,
 * }} PostOpts
 */

export const DIALECTS = {
  grbl: {
    title: 'GRBL (laser)',
    preamble: ['G21', 'G90', 'G17'],
    on: (S) => [`M3 S${S}`],
    off: () => ['M5'],
    postamble: ['M5', 'G17 G90', 'M2'],
    comment: (t) => `; ${t}`,
  },
  linuxcnc: {
    title: 'LinuxCNC',
    preamble: ['G17 G54 G40 G49 G80 G90', 'G21'],
    on: (S) => [`M3 S${S}`],
    off: () => ['M5'],
    postamble: ['M05', 'G17 G90', 'M2'],
    // RS-274: i commenti (…) non possono contenere parentesi annidate
    comment: (t) => `(${t.replace(/[()]/g, '')})`,
  },
};

/** Pierce delay in secondi: ~70 ms/mm, min 0.5 s (euristica del post plasma FreeCAD). */
export function pierceSeconds(thickness = 1, overrideMs) {
  if (overrideMs !== undefined) return overrideMs / 1000;
  return Math.round(Math.max(0.5, 0.07 * thickness) * 1000) / 1000;   // al ms
}

const f = (n) => {
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};

/**
 * Emette il programma G-code dal toolpath.
 * @param {CutOp[]} ops
 * @param {PostOpts} [opts]
 */
export function postGcode(ops, opts = {}) {
  const d = DIALECTS[opts.dialect || 'grbl'];
  const feed = opts.feed ?? 3000;
  const power = opts.power ?? 800;
  const pierce = pierceSeconds(opts.thickness, opts.pierceMs);
  const L = [];
  L.push(d.comment(`${opts.name || 'pezzo'} — generato da CAD/CAM visualLGE (post ${d.title})`));
  L.push(d.comment(`contorni: ${ops.length}, feed ${feed} mm/min, S${power}, pierce ${f(pierce)}s`));
  L.push(...d.preamble);
  ops.forEach((op, i) => {
    L.push(d.comment(`contorno ${i + 1}/${ops.length}${op.tag ? ` ${op.tag}` : ''} (profondita ${op.depth})`));
    const entry = op.lead.length ? op.lead[0] : op.pts[0];
    L.push(`G0 X${f(entry.x)} Y${f(entry.y)}`);
    L.push(...d.on(power));
    if (pierce > 0) L.push(`G4 P${f(pierce)}`);
    let first = true;
    // il lead termina ESATTAMENTE su pts[0]: emettilo, poi il contorno da k=1
    for (const p of op.lead.slice(1)) {
      L.push(`G1 X${f(p.x)} Y${f(p.y)}${first ? ` F${f(feed)}` : ''}`);
      first = false;
    }
    for (let k = 1; k < op.pts.length; k++) {
      const p = op.pts[k];
      L.push(`G1 X${f(p.x)} Y${f(p.y)}${first ? ` F${f(feed)}` : ''}`);
      first = false;
    }
    L.push(...d.off());
  });
  L.push(...d.postamble);
  return L.join('\n') + '\n';
}
