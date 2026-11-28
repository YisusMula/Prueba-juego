import { describe, expect, it } from 'vitest';
import { EQUIPMENT_TYPES } from '../src/schemas/index.js';
import { correctiveActionsFor } from '../src/scripts/seed-actions.js';

describe('datos de demostración: acciones correctoras coherentes con el equipo', () => {
  it('el frío nunca recalienta; lo caliente sí', () => {
    for (const t of ['camara', 'congelador', 'vitrina', 'abatidor'] as const) {
      const acts = correctiveActionsFor(t);
      expect(acts).toContain('Producto trasladado a otra cámara y termostato regulado');
      expect(acts.some((a) => /recalienta|75 °C/i.test(a))).toBe(false);
    }
    expect(correctiveActionsFor('mesa_caliente').some((a) => /recalienta/.test(a))).toBe(true);
  });

  it('todos los tipos tienen al menos una acción', () => {
    for (const t of EQUIPMENT_TYPES) expect(correctiveActionsFor(t).length).toBeGreaterThan(0);
  });
});
