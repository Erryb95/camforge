// @ts-check
// Registrazione del loader NC/G-code. È anche il fallback per estensioni sconosciute
// (molti post-processor usano estensioni proprietarie ma contenuto ISO standard).

import { registerLoader } from '../../core/registry.js';
import { parseNC } from './parser.js';

registerLoader(
  ['nc', 'gcode', 'ngc', 'tap', 'cnc', 'iso', 'eia', 'din', 'mpf', 'txt'],
  { name: 'NC / G-code', parse: parseNC },
  { isFallback: true },
);
