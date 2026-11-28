/**
 * Debe importarse ANTES que cualquier esquema: zod comprueba si puede usar `new Function` al crear
 * los esquemas, y la CSP del visor no permite eval (lo reportaría como violación).
 */
import { z } from 'zod';

z.config({ jitless: true });
