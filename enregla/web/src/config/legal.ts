/**
 * Datos del titular para las páginas legales. RELLÉNALOS antes de publicar la web.
 * Mientras contengan corchetes se muestran resaltados como marcadores pendientes.
 */
export const LEGAL = {
  ownerName: '[NOMBRE DEL TITULAR]',
  taxId: '[NIF]',
  address: '[DIRECCIÓN]',
  contactEmail: '[EMAIL DE CONTACTO]',
  registryData: '[DATOS DE INSCRIPCIÓN REGISTRAL, SI PROCEDE]',
  hostingProvider: '[PROVEEDOR DE ALOJAMIENTO]',
  hostingLocation: '[UBICACIÓN DE LOS SERVIDORES]',
  emailProvider: '[PROVEEDOR DE EMAIL]',
  jurisdiction: '[CIUDAD DE LOS JUZGADOS COMPETENTES]',
  lastUpdated: '[FECHA DE ÚLTIMA ACTUALIZACIÓN]',
} as const;

export type LegalKey = keyof typeof LEGAL;

/** true si el valor sigue siendo un marcador sin rellenar. */
export const isPlaceholder = (value: string): boolean => /^\[.*\]$/.test(value);
