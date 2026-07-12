// @ts-check
// Registrazione del loader DWG (fase 3, binario, parse asincrono).

import { registerLoader } from '../../core/registry.js';
import { parseDwg } from './parser.js';

registerLoader(['dwg'], { name: 'DWG (LibreDWG)', parse: parseDwg }, { binary: true });
