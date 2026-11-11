/**
 * Datos del titular para las páginas legales y email de soporte. Salen de variables de entorno
 * de compilación (VITE_LEGAL_*, VITE_SUPPORT_EMAIL; ver web/.env.example y el README).
 * Si falta un dato obligatorio se muestra un marcador resaltado; un build de producción sin
 * ellos falla (salvo VITE_ALLOW_PLACEHOLDER_LEGAL=true, solo para pruebas).
 */
const env = import.meta.env as Record<string, string | undefined>;
const read = (key: string): string | null => {
  const v = env[key]?.trim();
  return v ? v : null;
};

export type LegalKey =
  | 'ownerName'
  | 'taxId'
  | 'address'
  | 'contactEmail'
  | 'hostingProvider'
  | 'lastUpdated'
  | 'registryData'
  | 'hostingLocation'
  | 'emailProvider'
  | 'jurisdiction';

/** Valor (o null si no se ha configurado) y texto del marcador que se resalta si falta. */
export const LEGAL: Record<LegalKey, { value: string | null; placeholder: string }> = {
  ownerName: { value: read('VITE_LEGAL_OWNER_NAME'), placeholder: 'Nombre o razón social del titular' },
  taxId: { value: read('VITE_LEGAL_TAX_ID'), placeholder: 'NIF' },
  address: { value: read('VITE_LEGAL_ADDRESS'), placeholder: 'Dirección' },
  contactEmail: { value: read('VITE_LEGAL_CONTACT_EMAIL'), placeholder: 'Email de contacto' },
  hostingProvider: { value: read('VITE_LEGAL_HOSTING_PROVIDER'), placeholder: 'Proveedor de alojamiento' },
  lastUpdated: { value: read('VITE_LEGAL_LAST_UPDATED'), placeholder: 'Fecha de actualización' },
  registryData: { value: read('VITE_LEGAL_REGISTRY_DATA'), placeholder: '' },
  hostingLocation: { value: read('VITE_LEGAL_HOSTING_LOCATION'), placeholder: '' },
  emailProvider: { value: read('VITE_LEGAL_EMAIL_PROVIDER'), placeholder: '' },
  jurisdiction: { value: read('VITE_LEGAL_JURISDICTION'), placeholder: '' },
};

/** Email de soporte (opcional): se muestra en el pie, Facturación y pantallas de error. */
export const SUPPORT_EMAIL: string | null = read('VITE_SUPPORT_EMAIL');

/** URL pública de la web (canonical, Open Graph, sitemap). */
export const PUBLIC_URL: string | null = read('VITE_PUBLIC_URL')?.replace(/\/+$/, '') ?? null;

export const hasLegalPlaceholders = (Object.keys(LEGAL) as LegalKey[]).some((k) => LEGAL[k].placeholder && !LEGAL[k].value);
