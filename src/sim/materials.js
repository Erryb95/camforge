// @ts-check
// Materiali di FRESATURA (dati reali da cataloghi Sandvik/Kennametal/Harvey/Onsrud).
// Ogni materiale consiglia una PUNTA (utensile) diversa: numero taglienti, rivestimento
// (che dà anche il colore della fresa nel viewer) e geometria. Vc = velocità di taglio.
// La punta cambia in base al materiale scelto (colore = rivestimento, geometria = tipo).

// Colore realistico del rivestimento della fresa (RGB).
const COAT = {
  nessuno: [0xc0, 0xc6, 0xcc],   // metallo duro lucido / non rivestito
  TiN: [0xd6, 0xb2, 0x54],       // oro
  TiCN: [0x7c, 0x86, 0xa0],      // blu-grigio
  TiAlN: [0x6a, 0x5a, 0x78],     // viola-antracite
  AlTiN: [0x4c, 0x46, 0x58],     // viola scuro
  AlCrN: [0x6a, 0x52, 0x44],     // bronzo scuro
  DLC: [0x2c, 0x2e, 0x34],       // nero
  ZrN: [0xcc, 0xbc, 0x78],       // oro chiaro
};
/** @param {string} c */
export function coatingColor(c) {
  const key = String(c).split(/[\s/]+/)[0];   // "TiAlN o AlTiN" → "TiAlN"
  return COAT[key] || COAT.nessuno;
}

/**
 * @typedef {{id:string,name:string,cat:string,vc:string,toolMat:string,coating:string,flutes:number,geom:string,note:string}} Material
 */
/** @type {Material[]} */
export const MATERIALS = [
  { id: 'al6061', name: 'Alluminio 6061', cat: 'alluminio', vc: '300–1000', toolMat: 'metallo duro', coating: 'nessuno', flutes: 2, geom: 'high-helix 40°', note: 'Tenero e appiccicoso: elica alta, taglienti affilati, no rivestimenti al Ti.' },
  { id: 'al7075', name: 'Alluminio 7075', cat: 'alluminio', vc: '250–800', toolMat: 'metallo duro', coating: 'nessuno', flutes: 3, geom: 'high-helix 40–45°', note: 'Più duro del 6061, truciolo più corto: regge 3 taglienti.' },
  { id: 's1018', name: 'Acciaio 1018', cat: 'acciaio', vc: '80–150', toolMat: 'metallo duro', coating: 'TiCN', flutes: 4, geom: 'elica 30°', note: 'Filante, tende a incollare il tagliente: TiCN riduce l’adesione. Refrigerante.' },
  { id: 's4140', name: 'Acciaio 4140', cat: 'acciaio', vc: '60–120', toolMat: 'metallo duro', coating: 'AlTiN', flutes: 4, geom: 'elica variabile 35°', note: 'Vc dipende dal trattamento. AlTiN per il calore, passo variabile anti-chatter.' },
  { id: 'inox304', name: 'Inox 304', cat: 'inox', vc: '60–120', toolMat: 'metallo duro', coating: 'TiAlN', flutes: 5, geom: 'elica variabile 38°', note: 'Incrudisce a freddo: avanzamento costante, mai strisciare. Refrigerante abbondante.' },
  { id: 'inox316', name: 'Inox 316', cat: 'inox', vc: '50–100', toolMat: 'metallo duro', coating: 'AlCrN', flutes: 5, geom: 'elica variabile 38°', note: 'Più gommoso del 304 (Mo): Vc più bassa, più calore. Refrigerante alta pressione.' },
  { id: 'ottone', name: 'Ottone', cat: 'ottone', vc: '150–400', toolMat: 'metallo duro', coating: 'nessuno', flutes: 3, geom: 'elica bassa 15°', note: 'Truciolo corto: elica alta “tira” il pezzo, meglio elica bassa/diritta. Poco calore.' },
  { id: 'rame', name: 'Rame', cat: 'rame', vc: '150–400', toolMat: 'metallo duro', coating: 'DLC', flutes: 2, geom: 'high-helix 38°', note: 'Tenace e appiccicoso: taglienti affilati, gole lucide, DLC anti-adesione.' },
  { id: 'ti6al4v', name: 'Titanio Ti6Al4V', cat: 'titanio', vc: '30–70', toolMat: 'metallo duro', coating: 'AlTiN', flutes: 5, geom: 'elica variabile 37°', note: 'Bassa conducibilità: calore sul tagliente → Vc bassa, trocoidale, refrigerante HP.' },
  { id: 'ghisa', name: 'Ghisa grigia', cat: 'ghisa', vc: '80–150', toolMat: 'metallo duro', coating: 'nessuno', flutes: 4, geom: 'elica 30°', note: 'Abrasiva, truciolo corto e polverulento: spesso a secco. Usura per abrasione.' },
  { id: 'pom', name: 'POM / Delrin', cat: 'plastica', vc: '300–800', toolMat: 'metallo duro', coating: 'nessuno', flutes: 1, geom: 'O-flute single-flute', note: 'Truciolo continuo: gole ampie, 1 tagliente per finitura pulita, aria per evacuazione.' },
  { id: 'abs', name: 'ABS', cat: 'plastica', vc: '200–500', toolMat: 'metallo duro', coating: 'nessuno', flutes: 1, geom: 'O-flute up-cut', note: 'Basso punto di rammollimento: 1 tagliente, alto avanzamento, aria compressa.' },
  { id: 'pc', name: 'Policarbonato', cat: 'plastica', vc: '200–500', toolMat: 'metallo duro', coating: 'nessuno', flutes: 1, geom: 'O-flute affilato', note: 'Sensibile al calore/cricche: tagliente lucido affilato, single-flute.' },
  { id: 'legno', name: 'Legno duro', cat: 'legno', vc: '250–600', toolMat: 'metallo duro', coating: 'nessuno', flutes: 2, geom: 'up/down-cut', note: 'Compression bit per bordi netti su entrambe le facce; alta rotazione.' },
  { id: 'mdf', name: 'MDF', cat: 'legno', vc: '250–600', toolMat: 'metallo duro', coating: 'nessuno', flutes: 2, geom: 'straight/2-flute', note: 'Molto abrasivo (colla): usura rapida, metallo duro obbligatorio, aspirazione.' },
  { id: 'gfk', name: 'GFK / composito', cat: 'composito', vc: '100–300', toolMat: 'metallo duro', coating: 'DLC', flutes: 4, geom: 'diamond-cut / compression', note: 'Fibre abrasive e delaminanti: fresa a intreccio (diamond-cut) o compression, DLC/diamante.' },
];

export const DEFAULT_MATERIAL = MATERIALS[0];
/** @param {string} id */
export function materialById(id) { return MATERIALS.find((m) => m.id === id) || DEFAULT_MATERIAL; }
