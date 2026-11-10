import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, '.runtime');

export const DEMO = { email: 'demo@example.com', password: 'Demo-EnRegla-2026' };

/** Último enlace con #token= enviado a `to` (transporte de email "console" del servidor). */
export async function lastEmailLink(to: string, pathPrefix: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = readFileSync(path.join(runtime, 'server.log'), 'utf8');
    const blocks = log.split('=== EMAIL (desarrollo) ===').slice(1).filter((b) => b.includes(`Para: ${to}`));
    for (const b of blocks.reverse()) {
      const m = b.match(new RegExp(`https?://[^\\s]+${pathPrefix}#token=[A-Za-z0-9_-]+`));
      if (m) return m[0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No llegó ningún email a ${to} con ${pathPrefix}`);
}

export function seedInfo() {
  const txt = readFileSync(path.join(runtime, 'seed.txt'), 'utf8');
  return { kioskToken: txt.match(/kd_[A-Za-z0-9_-]{43}/)?.[0] ?? '', menuSlug: txt.match(/menu\/([A-Za-z0-9_-]+)/)?.[1] ?? '' };
}

export async function sql(query: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL ?? 'postgres://enregla:enregla@localhost:5432/enregla_e2e' });
  await c.connect();
  try {
    return await c.query(query, params);
  } finally {
    await c.end();
  }
}

export async function login(page: Page, email = DEMO.email, password = DEMO.password) {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/locales\/[0-9a-f-]+\/hoy|\/nuevo-local/);
}

export async function logout(page: Page) {
  // En escritorio el botón está en la barra lateral.
  await page.getByRole('button', { name: 'Cerrar sesión' }).first().click();
  await expect(page).toHaveURL(/\/entrar\?salida=1/);
  await expect(page.getByText('Has cerrado sesión')).toBeVisible();
}

/**
 * Fixture: falla la prueba si hay errores de JavaScript o violaciones de CSP en consola.
 * (Los 4xx esperados de la API —p. ej. 401 antes de entrar o PIN incorrecto— se ignoran.)
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/Failed to load resource: the server responded with a status of (4\d\d|502|503)/.test(t)) return; // 502/503: errores de Stripe que la web debe mostrar (se simulan en la e2e)
        problems.push(`console: ${t}`);
      });
      await use();
      expect(problems, problems.join('\n')).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** Cabeceras para llamar a la API desde page.request (CSRF de la SPA). */
export const apiHeaders = (page: Page) => ({ 'X-Requested-With': 'XMLHttpRequest', Origin: new URL(page.url() || 'http://localhost:3100').origin });

/** Crea, verifica (por el enlace del email) y deja lista una cuenta nueva. */
export async function createVerifiedAccount(page: Page, email: string, password: string, name: string) {
  const origin = `http://localhost:${process.env.E2E_PORT ?? '3100'}`;
  const res = await page.request.post(`${origin}/api/auth/register`, {
    data: { email, password, name },
    headers: { 'X-Requested-With': 'XMLHttpRequest', Origin: origin },
  });
  expect(res.status()).toBe(202);
  const link = await lastEmailLink(email, '/verificar-email');
  const token = link.split('#token=')[1]!;
  const v = await page.request.post(`${origin}/api/auth/verify-email`, { data: { token }, headers: { 'X-Requested-With': 'XMLHttpRequest', Origin: origin } });
  expect(v.status()).toBe(200);
}

/**
 * Pasada de axe-core: falla con violaciones serias o críticas (WCAG 2.x A/AA).
 */
export async function expectNoSeriousA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = serious.map((v) => `${label}: [${v.impact}] ${v.id} — ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n   ')}`).join('\n');
  expect(serious, summary).toEqual([]);
}
