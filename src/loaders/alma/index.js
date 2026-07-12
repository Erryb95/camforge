// @ts-check
// Registrazione loader .cn / .ctd. L'estensione è SOVRACCARICA:
//  - .cn/.ctd XML <LXDDocument>  → formato LXD (AlmaCAM che esporta per Friendess)
//  - .cn G-code (% .cn, G2292…)  → programma macchina, dialetto Cutlite/.pgm
// Si sceglie il parser dal CONTENUTO, non dall'estensione.

import { registerLoader } from '../../core/registry.js';
import { parseAlma } from './parser.js';
import { parseNC } from '../nc/parser.js';

/**
 * @param {string} text
 * @param {string} [fileName]
 */
function parseCn(text, fileName = '') {
  const head = text.slice(0, 256).replace(/^﻿/, '').trimStart();
  if (head.startsWith('<')) return parseAlma(text, fileName);   // LXD XML
  return parseNC(text, fileName);                                // NC G-code
}

registerLoader(['cn', 'ctd'], { name: 'Tubo (.cn: LXD o NC)', parse: parseCn });
