// @ts-check
// Registrazione del loader STEP/IGES/BREP (fase 3, parse asincrono, OpenCascade).

import { registerLoader } from '../../core/registry.js';
import { parseStep } from './parser.js';

registerLoader(['stp', 'step', 'igs', 'iges', 'brep'],
  { name: 'STEP/IGES (OpenCascade)', parse: parseStep });
