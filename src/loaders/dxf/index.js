// @ts-check
// Registrazione del loader DXF (fase 2).

import { registerLoader } from '../../core/registry.js';
import { parseDXF } from './parser.js';

registerLoader(['dxf'], { name: 'DXF', parse: parseDXF });
