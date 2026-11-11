/**
 * Marca: ÚNICA fuente de verdad del nombre comercial en el frontend.
 * Se configura con la variable de entorno VITE_APP_NAME (por defecto "EnRegla").
 * index.html y el manifiesto de la PWA reciben el mismo valor desde vite.config.ts.
 */
export const APP_NAME: string = (import.meta.env.VITE_APP_NAME as string | undefined)?.trim() || 'EnRegla';

/** Precios mostrados en la web pública (IVA no incluido). Coinciden con los del servidor. */
export const PRICING = {
  monthly: 12,
  annual: 120,
  trialDays: 14,
} as const;
