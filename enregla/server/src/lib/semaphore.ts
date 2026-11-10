/**
 * Semáforo con cola corta y justa (FIFO):
 *  - `tryAcquire()` toma un hueco si lo hay (sin esperar);
 *  - `acquire(maxWaitMs)` espera en cola, por orden de llegada, como mucho `maxWaitMs`; si la cola
 *    ya tiene `maxQueue` peticiones esperando o se agota la espera, devuelve null (nunca hay una cola
 *    infinita). Al liberar un hueco se entrega directamente a la primera petición de la cola.
 */
export class TrySemaphore {
  private used = 0;
  private readonly waiters: { grant: (release: () => void) => void; timer: NodeJS.Timeout }[] = [];
  constructor(
    readonly capacity: number,
    readonly maxQueue = 50,
  ) {}

  get inUse(): number {
    return this.used;
  }

  get queued(): number {
    return this.waiters.length;
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        // El hueco pasa a la siguiente petición sin quedar libre entre medias.
        clearTimeout(next.timer);
        next.grant(this.makeRelease());
      } else {
        this.used -= 1;
      }
    };
  }

  /** Devuelve una función de liberación idempotente, o null si no hay hueco. */
  tryAcquire(): (() => void) | null {
    if (this.used >= this.capacity || this.waiters.length > 0) return null;
    this.used += 1;
    return this.makeRelease();
  }

  /** Espera un hueco por orden de llegada; null si la cola está llena o se agota la espera. */
  acquire(maxWaitMs: number, signal?: AbortSignal): Promise<(() => void) | null> {
    const now = this.tryAcquire();
    if (now) return Promise.resolve(now);
    if (maxWaitMs <= 0 || this.waiters.length >= this.maxQueue || signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter = {
        grant: (release: () => void) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(release);
        },
        timer: setTimeout(() => leave(), maxWaitMs),
      };
      const leave = () => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(null);
      };
      const onAbort = () => leave();
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }
}
