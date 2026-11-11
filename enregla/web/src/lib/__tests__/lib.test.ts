import { describe, expect, it, beforeEach } from 'vitest';
import { formatRange, formatTemp, isOutOfRange, parseDecimal, addDaysIso, localDateIn, formatLocalDate } from '../format';
import { safeNext } from '../redirect';
import { passwordProblem, passwordAcceptable, passwordChecks, passwordScore } from '../password';
import { takeHashToken } from '../hashToken';
import { filenameFromDisposition } from '../download';
import { storage } from '../storage';
import { errorMessage, ApiError, formatWait, qs } from '@/api/client';
import { keypadToNumber, keypadDisplay } from '@/components/ui/Keypad';

describe('formatos es-ES', () => {
  it('usa coma decimal y signo menos tipográfico', () => {
    expect(formatTemp(3.5)).toBe('3,5 °C');
    expect(formatTemp(-18)).toBe('−18 °C');
    expect(formatTemp(null)).toBe('—');
  });
  it('describe rangos opcionales', () => {
    expect(formatRange(null, 4)).toBe('máx. 4 °C');
    expect(formatRange(63, null)).toBe('mín. 63 °C');
    expect(formatRange(0, 4)).toBe('0 °C a 4 °C');
    expect(formatRange(null, null)).toBe('sin límites');
  });
  it('interpreta números escritos a mano', () => {
    expect(parseDecimal('3,5')).toBe(3.5);
    expect(parseDecimal(' −18 ')).toBe(-18);
    expect(parseDecimal('-0.5')).toBe(-0.5);
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('3,')).toBeNull();
  });
  it('detecta fuera de rango con límites opcionales', () => {
    expect(isOutOfRange(5, null, 4)).toBe(true);
    expect(isOutOfRange(4, null, 4)).toBe(false);
    expect(isOutOfRange(60, 63, null)).toBe(true);
    expect(isOutOfRange(100, null, null)).toBe(false);
  });
  it('calcula fechas locales', () => {
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(localDateIn('Europe/Madrid', new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-10');
    expect(formatLocalDate('2026-11-09')).toMatch(/9 nov/);
  });
});

describe('redirección tras el login (sin open redirect)', () => {
  it.each([
    ['/locales/x/hoy', '/locales/x/hoy'],
    ['%2Flocales%2Fx%2Fhistorial%3Ftipo%3Dlimpieza', '/locales/x/historial?tipo=limpieza'],
    ['//evil.com', '/app'],
    ['/\\evil.com', '/app'],
    ['https://evil.com', '/app'],
    ['javascript:alert(1)', '/app'],
    ['/entrar', '/app'],
    [null, '/app'],
  ])('%s → %s', (input, out) => {
    expect(safeNext(input)).toBe(out);
  });
});

describe('requisitos de contraseña', () => {
  it('coinciden con la política del servidor', () => {
    expect(passwordAcceptable('corta')).toBe(false);
    expect(passwordAcceptable('aaaaaaaaaaaa')).toBe(false);
    // Comunes: solo la coincidencia exacta; email y nombre: también si los CONTIENE (política compartida).
    expect(passwordAcceptable('ana.martin', 'ana.martin@x.es')).toBe(false);
    expect(passwordAcceptable('ana.martin2', 'ana.martin@x.es')).toBe(false);
    expect(passwordAcceptable('Contrasena-Larga-77x')).toBe(true);
    expect(passwordAcceptable('CONTRASENA123')).toBe(false);
    expect(passwordAcceptable('Pepa Ruiz Gil', '', 'pepa ruiz gil')).toBe(false);
    expect(passwordProblem('qwertyuiop')).toMatch(/más usadas/);
    expect(passwordAcceptable('Cocina-Limpia-2026')).toBe(true);
    expect(passwordAcceptable('Mi-AnaMartin-99x', 'ana.martin@x.es')).toBe(false);
    expect(passwordAcceptable('ana2026xyz', 'ana@x.es')).toBe(false);
    expect(passwordAcceptable('Cocina-Limpia-2026', 'ana.martin@x.es', 'Ana Martín')).toBe(true);
    expect(passwordAcceptable('Josefina-Cocina-1', '', 'Josefina Ruiz')).toBe(false);
    expect(passwordAcceptable('JOSÉFINA-cocina-1', '', 'Josefina Ruiz')).toBe(false);
    const personal = passwordChecks('ana.martin2', 'ana.martin@x.es').find((c) => c.id === 'personal');
    expect(personal?.ok).toBe(false);
    expect(personal?.label).toBe('No contiene tu email ni tu nombre');
    expect(passwordProblem('ana.martin2', 'ana.martin@x.es')).toMatch(/ni contenerlos/);
    expect(passwordChecks('').every((c) => !c.ok)).toBe(true);
    expect(passwordScore('Cocina-Limpia-2026!')).toBeGreaterThanOrEqual(3);
  });
});

describe('token en el fragmento', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));
  it('lo lee, lo quita de la URL y es idempotente', () => {
    window.history.replaceState(null, '', '/verificar-email#token=abcdefghijklmnopqrstuvwxyz');
    expect(takeHashToken()).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(window.location.hash).toBe('');
    expect(takeHashToken()).toBe('abcdefghijklmnopqrstuvwxyz');
  });
});

describe('teclado numérico', () => {
  it('convierte la entrada', () => {
    expect(keypadToNumber('-18,5')).toBe(-18.5);
    expect(keypadToNumber('3,')).toBeNull();
    expect(keypadToNumber('-')).toBeNull();
    expect(keypadDisplay('-3')).toBe('−3');
  });
});

describe('cliente de la API', () => {
  it('mensaje amable con Retry-After', () => {
    expect(formatWait(30)).toBe('30 segundos');
    expect(formatWait(130)).toBe('3 minutos');
    expect(formatWait(3600)).toBe('1 hora');
    const e = new ApiError(429, 'RATE_LIMITED', 'Demasiadas peticiones.', [], 120);
    expect(errorMessage(e)).toBe('Demasiadas peticiones. Inténtalo de nuevo en 2 minutos.');
    expect(errorMessage(new Error('x'))).toMatch(/Inténtalo/);
  });
  it('construye query strings sin vacíos', () => {
    expect(qs({ a: 1, b: '', c: null, d: 'x y' })).toBe('?a=1&d=x+y');
  });
  it('lee el nombre del fichero', () => {
    expect(filenameFromDisposition('attachment; filename="registros-bar-2026.pdf"', 'x')).toBe('registros-bar-2026.pdf');
    expect(filenameFromDisposition(null, 'x.csv')).toBe('x.csv');
  });
});

describe('almacenamiento local', () => {
  it('solo acepta tokens de kiosko con formato válido', () => {
    storage.setKioskToken('no-valido');
    expect(storage.getKioskToken()).toBeNull();
    const t = `kd_${'a'.repeat(43)}`;
    storage.setKioskToken(t);
    expect(storage.getKioskToken()).toBe(t);
    storage.setKioskToken(null);
    expect(storage.getKioskToken()).toBeNull();
  });
});
