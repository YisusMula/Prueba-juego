import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client';
import type {
  Account,
  AppRecord,
  AuditEvent,
  Billing,
  CleaningPlan,
  Compliance,
  Device,
  Dish,
  Equipment,
  Invitation,
  Member,
  Organization,
  Page,
  PublicMenuSettings,
  RecordDetail,
  RecordType,
  Staff,
  Supplier,
  TodayTasks,
} from './types';

export const keys = {
  account: ['account'] as const,
  orgs: ['orgs'] as const,
  org: (orgId: string) => ['org', orgId] as const,
  orgScoped: (orgId: string, ...rest: unknown[]) => ['org', orgId, ...rest] as const,
};

const base = (orgId: string) => `/api/orgs/${orgId}`;

export function useAccount() {
  return useQuery({
    queryKey: keys.account,
    queryFn: () => api.get<Account>('/api/account', { silentAuth: true }),
    retry: false,
    staleTime: 60_000,
  });
}

export function useOrg(orgId: string) {
  return useQuery({
    queryKey: keys.org(orgId),
    queryFn: () => api.get<{ organization: Organization }>(base(orgId)).then((r) => r.organization),
    staleTime: 30_000,
  });
}

export function useToday(orgId: string) {
  return useQuery({
    queryKey: keys.orgScoped(orgId, 'today'),
    queryFn: () => api.get<TodayTasks>(`${base(orgId)}/tasks/today`),
    refetchInterval: 60_000,
  });
}

export function useCompliance(orgId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: keys.orgScoped(orgId, 'compliance', from, to),
    queryFn: () => api.get<Compliance>(`${base(orgId)}/tasks/compliance${qs({ from, to })}`),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** Lista completa de un recurso de configuración (pagina internamente hasta el final; límite de seguridad 10 páginas). */
async function fetchAll<T>(url: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const sep = url.includes('?') ? '&' : '?';
    const page: Page<T> = await api.get<Page<T>>(`${url}${sep}limit=200${cursor ? `&cursor=${cursor}` : ''}`);
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

export function useStaff(orgId: string) {
  return useQuery({ queryKey: keys.orgScoped(orgId, 'staff'), queryFn: () => fetchAll<Staff>(`${base(orgId)}/staff`) });
}
export function useEquipment(orgId: string) {
  return useQuery({ queryKey: keys.orgScoped(orgId, 'equipment'), queryFn: () => fetchAll<Equipment>(`${base(orgId)}/equipment`) });
}
export function useCleaningPlans(orgId: string) {
  return useQuery({ queryKey: keys.orgScoped(orgId, 'cleaning-plans'), queryFn: () => fetchAll<CleaningPlan>(`${base(orgId)}/cleaning-plans`) });
}
export function useSuppliers(orgId: string) {
  return useQuery({ queryKey: keys.orgScoped(orgId, 'suppliers'), queryFn: () => fetchAll<Supplier>(`${base(orgId)}/suppliers`) });
}
export function useDevices(orgId: string) {
  return useQuery({ queryKey: keys.orgScoped(orgId, 'devices'), queryFn: () => fetchAll<Device>(`${base(orgId)}/devices`) });
}
export function useDishes(orgId: string) {
  return useQuery({ queryKey: keys.orgScoped(orgId, 'dishes'), queryFn: () => fetchAll<Dish>(`${base(orgId)}/dishes`) });
}
export function useMembers(orgId: string) {
  return useQuery({ queryKey: keys.orgScoped(orgId, 'members'), queryFn: () => api.get<Page<Member>>(`${base(orgId)}/members`).then((p) => p.items) });
}
export function useInvitations(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.orgScoped(orgId, 'invitations'),
    queryFn: () => api.get<Page<Invitation>>(`${base(orgId)}/invitations`).then((p) => p.items),
    enabled,
  });
}
export function usePublicMenuSettings(orgId: string) {
  return useQuery({
    queryKey: keys.orgScoped(orgId, 'public-menu'),
    queryFn: () => api.get<{ publicMenu: PublicMenuSettings }>(`${base(orgId)}/public-menu`).then((r) => r.publicMenu),
  });
}
export function useBilling(orgId: string) {
  return useQuery({ queryKey: keys.orgScoped(orgId, 'billing'), queryFn: () => api.get<Billing>(`${base(orgId)}/billing`) });
}
export function useMembership(orgId: string) {
  return useQuery({
    queryKey: keys.orgScoped(orgId, 'membership'),
    queryFn: () => api.get<{ role: string; dailyReminder: boolean }>(`${base(orgId)}/membership`),
  });
}

export type RecordFilters = { type?: RecordType | ''; from?: string; to?: string; alert?: 'true' | 'false' | ''; equipmentId?: string; staffId?: string };

export function useRecords(orgId: string, filters: RecordFilters, pageSize = 25) {
  return useInfiniteQuery({
    queryKey: keys.orgScoped(orgId, 'records', filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Page<AppRecord>>(`${base(orgId)}/records${qs({ ...filters, limit: pageSize, cursor: pageParam })}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useRecord(orgId: string, recordId: string) {
  return useQuery({ queryKey: keys.orgScoped(orgId, 'record', recordId), queryFn: () => api.get<RecordDetail>(`${base(orgId)}/records/${recordId}`) });
}

export function useAudit(orgId: string) {
  return useInfiniteQuery({
    queryKey: keys.orgScoped(orgId, 'audit'),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Page<AuditEvent>>(`${base(orgId)}/audit${qs({ limit: 30, cursor: pageParam })}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Mutación genérica dentro de un local que invalida las consultas del local al terminar. */
export function useOrgMutation<TVars, TResult = unknown>(orgId: string, fn: (vars: TVars) => Promise<TResult>, invalidate: unknown[][] = [[]]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: ['org', orgId, ...k] })));
    },
  });
}

export const orgApi = (orgId: string) => ({
  base: base(orgId),
  createRecord: (body: { type: RecordType; data: unknown; staffId?: string | null }) =>
    api.post<{ record: AppRecord }>(`${base(orgId)}/records`, body).then((r) => r.record),
  amend: (recordId: string, body: { reason: string; data: unknown; staffId?: string | null }) =>
    api.post<{ record: AppRecord }>(`${base(orgId)}/records/${recordId}/amendments`, body).then((r) => r.record),
});
