/**
 * Almacén del estado de la demo. Vive en memoria; si el navegador lo permite se copia en
 * localStorage para sobrevivir a una recarga (con try/catch: puede estar bloqueado o vacío).
 */
import { STATE_VERSION, type DemoState } from './state';
import { seedDemo, TZ } from './seed';
import { localDate } from './time';

const KEY = 'enregla.demo.state.v1';
let db: DemoState | null = null;
let saveTimer: number | undefined;

function readSaved(): DemoState | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoState;
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.records) || !Array.isArray(parsed.orgs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeNow(): void {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!db) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // almacenamiento bloqueado o lleno: la demo sigue en memoria
  }
}

/** Estado actual (se crea al primer uso). Si los datos guardados son de otro día, se regeneran. */
export function getDb(): DemoState {
  if (!db) {
    const saved = readSaved();
    db = saved && saved.seededOn === localDate(new Date(), TZ) ? saved : seedDemo();
    if (!saved || saved !== db) writeNow();
  }
  return db;
}

/** Guarda (agrupando escrituras seguidas). */
export function persist(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(writeNow, 150);
}

/** Vuelve a los datos iniciales. */
export function resetDb(): DemoState {
  db = seedDemo();
  writeNow();
  return db;
}
