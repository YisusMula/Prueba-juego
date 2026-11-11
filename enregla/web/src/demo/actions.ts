/** Atajos de la demo que consultan o preparan el estado simulado (sin pasar por la red). */
import { storage } from '@/lib/storage';
import { getDb, persist } from './server/store';
import { newDeviceToken, uuid } from './server/ids';

/** Primer local del usuario demo (aunque haya cerrado sesión). */
export function demoOrg() {
  const db = getDb();
  const user = db.users[0];
  const ids = new Set(db.memberships.filter((m) => m.userId === user?.id).map((m) => m.orgId));
  return db.orgs.filter((o) => ids.has(o.id)).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
}

/** Ruta inicial: «Hoy» del local demo si hay sesión; si no, entrar. */
export function startPath(): string {
  const db = getDb();
  if (!db.sessionUserId) return '/entrar';
  const org = demoOrg();
  return org ? `/locales/${org.id}/hoy` : '/nuevo-local';
}

/** Deja esta «tablet» vinculada a una tablet activa del local demo (la de ejemplo o una nueva). */
export function pairDemoKiosk(): boolean {
  const org = demoOrg();
  if (!org) return false;
  const db = getDb();
  const current = storage.getKioskToken();
  if (current && db.devices.some((d) => d.token === current && d.revokedAt == null)) return true;
  let device = db.devices.find((d) => d.orgId === org.id && d.revokedAt == null);
  if (!device) {
    if (org.deletionScheduledAt) return false;
    device = { id: uuid(), orgId: org.id, name: 'Tablet cocina', token: newDeviceToken(), createdBy: db.users[0]?.id ?? null, createdAt: Date.now(), lastUsedAt: null, revokedAt: null };
    db.devices.push(device);
    persist();
  }
  storage.setKioskToken(device.token);
  return true;
}

export function publicMenuPath(): string | null {
  const org = demoOrg();
  return org ? `/carta/${org.publicMenuSlug}` : null;
}
