// @ts-check
// Registrazione del loader ActTubes (.atd) — solo metadati.

import { registerLoader } from '../../core/registry.js';
import { parseAtd } from './parser.js';

registerLoader(['atd'], { name: 'ActTubes (metadati)', parse: parseAtd });
