// @ts-check
// Registrazione del loader AlmaCAM (.cn / .ctd).

import { registerLoader } from '../../core/registry.js';
import { parseAlma } from './parser.js';

registerLoader(['cn', 'ctd'], { name: 'AlmaCAM tubo', parse: parseAlma });
