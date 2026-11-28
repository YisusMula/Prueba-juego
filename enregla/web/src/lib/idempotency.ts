import { useState } from 'react';

/** UUID v4 (crypto.randomUUID si existe; si no, a partir de getRandomValues). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Clave de idempotencia por intento de registro (API §1.7): se genera al pulsar «Guardar» y se
 * REUTILIZA en los reintentos de ese mismo formulario mientras el cuerpo no cambie. Si el usuario
 * cambia los datos, es otro registro: clave nueva. Tras un éxito se descarta (`reset`).
 */
export class IdempotencyKeys {
  private current: { key: string; body: string } | null = null;
  keyFor(body: unknown): string {
    const json = JSON.stringify(body);
    if (!this.current || this.current.body !== json) this.current = { key: newIdempotencyKey(), body: json };
    return this.current.key;
  }
  reset(): void {
    this.current = null;
  }
}

export function useIdempotencyKeys(): IdempotencyKeys {
  const [keys] = useState(() => new IdempotencyKeys());
  return keys;
}
