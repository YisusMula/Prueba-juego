import { createContext, useContext } from 'react';
import type { Organization } from '@/api/types';

export type OrgCtx = {
  org: Organization;
  orgId: string;
  readOnly: boolean;
  isOwner: boolean;
  tz: string;
  /** Prefijo de rutas del local: /locales/{id} */
  path: (sub?: string) => string;
};

export const OrgContext = createContext<OrgCtx | null>(null);

export function useOrgContext(): OrgCtx {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrgContext fuera de un local');
  return ctx;
}
