/** Semáforo no bloqueante: o hay hueco y se toma, o se rechaza (sin cola infinita). */
export class TrySemaphore {
  private used = 0;
  constructor(readonly capacity: number) {}

  get inUse(): number {
    return this.used;
  }

  /** Devuelve una función de liberación idempotente, o null si no hay hueco. */
  tryAcquire(): (() => void) | null {
    if (this.used >= this.capacity) return null;
    this.used += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.used -= 1;
    };
  }
}
