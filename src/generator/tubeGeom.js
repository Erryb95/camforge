// @ts-check
// Geometria della sezione del TUBO (tondo o rettangolare) condivisa dal wrap
// (tubeWrap.js) e dal post (post/plasmac.js): perimetro, punto (y,z) a una data
// ascissa perimetrale, distanza radiale. Modulo separato per evitare import
// circolari tra wrap e post.

/**
 * @typedef {{shape?:'round'|'rect', diameter?:number, width?:number, height?:number, length:number}} TubeShape
 */

/** Perimetro della sezione: tondo = πD, rettangolare = 2(w+h). @param {TubeShape} tube */
export function tubePerimeter(tube) {
  return (tube.shape === 'rect')
    ? 2 * ((tube.width || 0) + (tube.height || 0))
    : Math.PI * (tube.diameter || 0);
}

/**
 * Punto (y,z) della sezione a un'ascissa perimetrale `s` (mm): v=0 al centro
 * della faccia superiore (+Z), cresce verso +Y. Tondo = arco; rettangolare =
 * cammino sull'outline (top-right → destra → sotto → sinistra → top-left).
 * @param {number} s @param {TubeShape} tube @returns {{y:number, z:number}}
 */
export function tubeSectionAt(s, tube) {
  if (tube.shape === 'rect') {
    const w = tube.width || 0, h = tube.height || 0;
    const a = w / 2, b = h / 2, P = 2 * (w + h);
    let t = P > 0 ? ((s % P) + P) % P : 0;
    if (t < a) return { y: t, z: b };                 // metà destra faccia sup.
    t -= a;
    if (t < 2 * b) return { y: a, z: b - t };          // fianco destro
    t -= 2 * b;
    if (t < 2 * a) return { y: a - t, z: -b };         // fondo
    t -= 2 * a;
    if (t < 2 * b) return { y: -a, z: -b + t };        // fianco sinistro
    t -= 2 * b;
    return { y: -a + t, z: b };                        // metà sinistra faccia sup.
  }
  const R = (tube.diameter || 0) / 2;
  const phi = R > 0 ? s / R : 0;
  return { y: R * Math.sin(phi), z: R * Math.cos(phi) };
}

/**
 * Distanza radiale (dal centro sezione) del punto perimetrale `s`: costante = R
 * sul tondo, variabile sul rettangolo (lo spigolo è più lontano del centro
 * faccia). Serve al post "torcia che segue" per lo standoff Z. @param {number} s @param {TubeShape} tube
 */
export function tubeRadialAt(s, tube) {
  const p = tubeSectionAt(s, tube);
  return Math.hypot(p.y, p.z);
}
