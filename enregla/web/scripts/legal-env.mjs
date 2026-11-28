/**
 * Datos legales y de contacto que se inyectan en el build (variables VITE_*).
 * Lo usan vite.config.ts (para hacer FALLAR un build de producción incompleto) y las pruebas.
 * Sin dependencias: se ejecuta en Node durante el build.
 */

/** Obligatorias para publicar: sin ellas las páginas legales mostrarían marcadores. */
export const REQUIRED_LEGAL_ENV = [
  { key: 'VITE_LEGAL_OWNER_NAME', label: 'nombre o razón social del titular' },
  { key: 'VITE_LEGAL_TAX_ID', label: 'NIF del titular' },
  { key: 'VITE_LEGAL_ADDRESS', label: 'dirección postal del titular' },
  { key: 'VITE_LEGAL_CONTACT_EMAIL', label: 'email de contacto legal y de privacidad' },
  { key: 'VITE_LEGAL_HOSTING_PROVIDER', label: 'proveedor de alojamiento' },
  { key: 'VITE_LEGAL_LAST_UPDATED', label: 'fecha de última actualización de los textos legales' },
];

/** Opcionales: si faltan, el texto se adapta (no se muestran marcadores). */
export const OPTIONAL_LEGAL_ENV = [
  'VITE_LEGAL_REGISTRY_DATA',
  'VITE_LEGAL_HOSTING_LOCATION',
  'VITE_LEGAL_EMAIL_PROVIDER',
  'VITE_LEGAL_JURISDICTION',
  'VITE_SUPPORT_EMAIL',
  'VITE_PUBLIC_URL',
];

const filled = (v) => typeof v === 'string' && v.trim() !== '';

/** Lista de variables obligatorias que faltan. */
export function missingLegalEnv(env) {
  return REQUIRED_LEGAL_ENV.filter((v) => !filled(env[v.key]));
}

/**
 * Comprueba el entorno de un build de producción. Devuelve null si se puede compilar, o el
 * mensaje de error (en español) con lo que falta. `VITE_ALLOW_PLACEHOLDER_LEGAL=true` lo permite
 * a propósito (pruebas e2e y CI), mostrando los marcadores resaltados.
 */
export function checkLegalEnv(env) {
  const missing = missingLegalEnv(env);
  if (missing.length === 0) return null;
  if (String(env.VITE_ALLOW_PLACEHOLDER_LEGAL ?? '').toLowerCase() === 'true') return null;
  return [
    'No se puede compilar la web para producción: faltan los datos legales del titular.',
    'Define estas variables de entorno (o en web/.env.production) antes de `npm run build`:',
    ...missing.map((m) => `  - ${m.key}: ${m.label}`),
    'Para una compilación de pruebas (e2e/CI) sin datos reales, usa VITE_ALLOW_PLACEHOLDER_LEGAL=true.',
  ].join('\n');
}
