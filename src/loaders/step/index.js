// @ts-check
// Registrazione del loader STEP (fase 3, parse asincrono).

import { registerLoader } from '../../core/registry.js';
import { parseStep } from './parser.js';

registerLoader(['stp', 'step'], { name: 'STEP (OpenCascade)', parse: parseStep });
