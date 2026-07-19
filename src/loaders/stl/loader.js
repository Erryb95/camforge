// @ts-check
// Registra .stl come formato APRIBILE nel viewer (mesh solida 3D). Riusa parseSTL
// (lo stesso usato per le teste laser). Solo geometria: nessun percorso utensile.
import { registerLoader } from '../../core/registry.js';
import { parseSTL, meshBounds } from './index.js';

export function parseStlModel(content, fileName = '') {
  const mesh = parseSTL(content, 0);
  if (!mesh.positions.length) throw new Error('STL vuoto o non valido');
  const b = meshBounds(mesh);
  const bounds = {
    min: { x: b.min[0], y: b.min[1], z: b.min[2] },
    max: { x: b.max[0], y: b.max[1], z: b.max[2] },
  };
  return {
    name: fileName, program: null, units: /** @type {'mm'} */ ('mm'),
    segments: [], drillPoints: [], warnings: [], rawLines: [],
    bounds, boundsFeed: null,
    mesh,
    meta: { stl: true, tris: mesh.indices.length / 3 },
    stats: { feedLen: 0, rapidLen: 0, timeMin: null, tools: [] },
  };
}

registerLoader(['stl'], { name: 'STL (mesh 3D)', parse: parseStlModel }, { binary: true });
