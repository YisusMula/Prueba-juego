import type { ReactNode } from 'react';
import { ALLERGEN_LABELS } from '@shared/schemas';
import type { AllergenId, AllergenStatus } from '@/api/types';

/**
 * Pictogramas propios de los 14 alérgenos (Anexo II, Reglamento UE 1169/2011).
 * Cada uno tiene un color propio para reconocerlo de un vistazo; el estado
 * (contiene / trazas / no) nunca se transmite solo por color: se acompaña de texto o forma.
 */
const GLYPHS: Record<AllergenId, ReactNode> = {
  gluten: (
    <>
      <path d="M12 20V7" />
      <path d="M12 9c-2.2 0-3.5-1.4-3.5-3.5C10.7 5.5 12 6.9 12 9zM12 9c2.2 0 3.5-1.4 3.5-3.5C13.3 5.5 12 6.9 12 9z" />
      <path d="M12 13c-2.2 0-3.5-1.4-3.5-3.5 2.2 0 3.5 1.4 3.5 3.5zM12 13c2.2 0 3.5-1.4 3.5-3.5-2.2 0-3.5 1.4-3.5 3.5z" />
      <path d="M12 17c-2.2 0-3.5-1.4-3.5-3.5 2.2 0 3.5 1.4 3.5 3.5zM12 17c2.2 0 3.5-1.4 3.5-3.5-2.2 0-3.5 1.4-3.5 3.5z" />
      <path d="M12 6.5V3.5" />
    </>
  ),
  crustaceans: (
    <>
      <path d="M6 15c0-4 3-7 7-7 2.5 0 4.5 1.2 5 3-2 0-3 1-3 2.5" />
      <path d="M6 15c1.2 2 3.4 3 6 3h3.5M8.5 17.5l-1 2.5M11.5 18l-.5 2.5M14.5 18l.2 2.5" />
      <path d="M13 8c-1-2.5-.5-4 1-5M15.5 9c.5-2.5 2-3.5 4-3.5" />
      <circle cx="15.5" cy="11.5" r=".6" fill="currentColor" />
    </>
  ),
  eggs: <path d="M12 3.5c3.3 0 6 5 6 9.5a6 6 0 01-12 0c0-4.5 2.7-9.5 6-9.5z" />,
  fish: (
    <>
      <path d="M3 12c2.5-3.5 6-5 9.5-5 3.5 0 6.2 2.3 7.5 5-1.3 2.7-4 5-7.5 5-3.5 0-7-1.5-9.5-5z" />
      <path d="M3 12l-1 -3.5M3 12l-1 3.5" />
      <circle cx="16" cy="11" r=".7" fill="currentColor" />
      <path d="M10 9.5c.8 1.6.8 3.4 0 5" />
    </>
  ),
  peanuts: (
    <>
      <path d="M12 3.5c2.6 0 4.2 2 4.2 4.2 0 1.6-.9 2.6-.9 4.3s.9 2.7.9 4.3c0 2.2-1.6 4.2-4.2 4.2s-4.2-2-4.2-4.2c0-1.6.9-2.6.9-4.3S7.8 9.3 7.8 7.7c0-2.2 1.6-4.2 4.2-4.2z" />
      <path d="M10.5 7h.01M13.5 8.5h.01M10.5 15.5h.01M13.5 17h.01" />
    </>
  ),
  soybeans: (
    <>
      <path d="M5 18c-1.5-1.5-1.2-4 .8-5.8l6.5-6.5c1.8-2 4.3-2.3 5.8-.8s1.2 4-.8 5.8l-6.5 6.5c-1.8 2-4.3 2.3-5.8.8z" />
      <circle cx="8.5" cy="14.5" r="1.6" />
      <circle cx="12" cy="11" r="1.6" />
      <circle cx="15.5" cy="7.5" r="1.6" />
    </>
  ),
  milk: (
    <>
      <path d="M9 3h6v3l2 3v11a1 1 0 01-1 1H8a1 1 0 01-1-1V9l2-3z" />
      <path d="M7 12h10M9 6h6" />
    </>
  ),
  nuts: (
    <>
      <path d="M5.5 10.5h13c0 5-3 9.5-6.5 9.5s-6.5-4.5-6.5-9.5z" />
      <path d="M4.5 10.5c0-3 3.3-5.5 7.5-5.5s7.5 2.5 7.5 5.5zM12 5V3" />
    </>
  ),
  celery: (
    <>
      <path d="M9 21V10M12 21V8M15 21V10" />
      <path d="M9 10c-2.5 0-4-1.8-4-4 2.3 0 4 1.5 4 4zM15 10c2.5 0 4-1.8 4-4-2.3 0-4 1.5-4 4zM12 8c0-2.5 1-4 3-5-.2 2.4-1 4-3 5zM12 8c0-2.5-1-4-3-5 .2 2.4 1 4 3 5z" />
    </>
  ),
  mustard: (
    <>
      <path d="M8 9h8l-.8 10.5a1.5 1.5 0 01-1.5 1.5h-3.4a1.5 1.5 0 01-1.5-1.5z" />
      <path d="M9.5 9V6.5h5V9M11 6.5L12 3l1 3.5" />
      <path d="M9.6 14h4.8" />
    </>
  ),
  sesame: (
    <>
      <ellipse cx="8" cy="9" rx="2" ry="3.2" transform="rotate(-25 8 9)" />
      <ellipse cx="15.5" cy="8" rx="2" ry="3.2" transform="rotate(20 15.5 8)" />
      <ellipse cx="11.5" cy="16" rx="2" ry="3.2" transform="rotate(-5 11.5 16)" />
    </>
  ),
  sulphites: (
    <>
      <path d="M7.5 3.5h9c0 4.5-1.5 7.5-4.5 7.5s-4.5-3-4.5-7.5z" />
      <path d="M12 11v8M8.5 20.5h7M8 7h8" />
    </>
  ),
  lupin: (
    <>
      <path d="M12 21V12" />
      <ellipse cx="12" cy="4.5" rx="1.6" ry="1.4" />
      <ellipse cx="10" cy="7.5" rx="1.8" ry="1.5" />
      <ellipse cx="14" cy="7.5" rx="1.8" ry="1.5" />
      <ellipse cx="9.3" cy="11" rx="2" ry="1.6" />
      <ellipse cx="14.7" cy="11" rx="2" ry="1.6" />
      <path d="M12 16c-2 0-3.5 1-4.5 2.5M12 16c2 0 3.5 1 4.5 2.5" />
    </>
  ),
  molluscs: (
    <>
      <path d="M12 19.5L4 10.5c1.5-3.5 4.5-5.5 8-5.5s6.5 2 8 5.5z" />
      <path d="M12 19.5V5M12 19.5L8 6.5M12 19.5l4-13M12 19.5L5.3 8M12 19.5l6.7-11.5" />
    </>
  ),
};

/** Tono propio de cada alérgeno (fondo del pictograma). */
export const ALLERGEN_HUES: Record<AllergenId, string> = {
  gluten: '#b7791f',
  crustaceans: '#c2410c',
  eggs: '#ca8a04',
  fish: '#1d6fa5',
  peanuts: '#92572b',
  soybeans: '#4d7c0f',
  milk: '#3b6ea8',
  nuts: '#7c4a2d',
  celery: '#3f8a3a',
  mustard: '#a16207',
  sesame: '#8b6b3d',
  sulphites: '#86295b',
  lupin: '#6d4fb3',
  molluscs: '#0f7a86',
};

type Props = {
  id: AllergenId;
  size?: number;
  /** Con estado: "no" se muestra atenuado y "traces" con borde discontinuo. */
  status?: AllergenStatus;
  /** Si es decorativo (hay texto al lado), no se anuncia. */
  decorative?: boolean;
  className?: string;
};

export function AllergenIcon({ id, size = 36, status = 'contains', decorative = true, className }: Props) {
  const hue = ALLERGEN_HUES[id];
  const muted = status === 'no';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      focusable="false"
    >
      {decorative ? null : <title>{ALLERGEN_LABELS[id]}</title>}
      <circle
        cx="16"
        cy="16"
        r="14.5"
        fill={muted ? 'none' : hue}
        stroke={muted ? 'currentColor' : hue}
        strokeOpacity={muted ? 0.35 : 1}
        strokeWidth={status === 'traces' ? 2 : 1.5}
        strokeDasharray={status === 'traces' ? '3.2 2.4' : undefined}
        fillOpacity={status === 'traces' ? 0.18 : 1}
      />
      <g
        transform="translate(4 4)"
        fill="none"
        stroke={muted ? 'currentColor' : status === 'traces' ? hue : '#ffffff'}
        strokeOpacity={muted ? 0.45 : 1}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[id]}
      </g>
    </svg>
  );
}

/** Nombres cortos para los chips del filtro (la leyenda oficial completa se muestra abajo). */
export const ALLERGEN_SHORT: Record<AllergenId, string> = {
  gluten: 'Gluten',
  crustaceans: 'Crustáceos',
  eggs: 'Huevo',
  fish: 'Pescado',
  peanuts: 'Cacahuete',
  soybeans: 'Soja',
  milk: 'Leche',
  nuts: 'Frutos de cáscara',
  celery: 'Apio',
  mustard: 'Mostaza',
  sesame: 'Sésamo',
  sulphites: 'Sulfitos',
  lupin: 'Altramuces',
  molluscs: 'Moluscos',
};
