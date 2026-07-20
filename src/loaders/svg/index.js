// @ts-check
// Registrazione del loader SVG (2D vettoriale) → SceneModel, apribile e wrappabile
// (taglio lamiera / rotary) come un DXF.

import { registerLoader } from '../../core/registry.js';
import { parseSVG } from './parser.js';

registerLoader(['svg'], { name: 'SVG (vettoriale 2D)', parse: parseSVG });
