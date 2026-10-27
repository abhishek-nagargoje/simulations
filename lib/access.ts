import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessStatus } from '@/lib/domain';

export type AccessRecord = {
  id: string;
  name: string;
  status: AccessStatus;
  app_slug: string;
  app_name: string;
  student_username: string;
  credential_version: number;
  duration_minutes: number;
  created_by_email: string | null;
  created_at: string;
  started_at: string | null;
  expires_at: string | null;
  closed_at: string | null;
  server_now: string;
};

export type Application = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  display_order: number;
};

export type ErpOverview = {
  baseline_loaded: boolean;
  last_import: { id: number; file_name: string; status: string; mapping_version: string; started_at: string; finished_at: string | null; error: string | null } | null;
  company_codes: { bukrs: string; name: string; city: string | null; currency: string; configured: boolean }[];
  posting_periods: { bukrs: string; fiscal_year: number; from_period: number; to_period: number }[];
};

type DbAccessRow = Omit<AccessRecord, 'app_slug' | 'app_name'> & { simulation_slug: string; simulation_name: string };

export async function listAccess(supabase: SupabaseClient, accessId?: string) {
  const { data, error } = await supabase.rpc('admin_list_classes', accessId ? { p_class_id: accessId } : {});
  // The database keeps its internal column names; the UI uses application names.
  const sessions = ((data ?? []) as DbAccessRow[]).map(({ simulation_slug, simulation_name, ...rest }) => ({
    ...rest,
    app_slug: simulation_slug,
    app_name: simulation_name,
  }));
  return { sessions: sessions as AccessRecord[], error };
}

export async function listApplications(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc('admin_list_simulations');
  return { applications: ((data ?? []) as Application[]).filter((a) => a.enabled), error };
}

export async function erpOverview(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc('admin_erp_overview');
  return { overview: (data ?? null) as ErpOverview | null, error };
}

export function accessUrl(origin: string, accessId: string) {
  return `${origin.replace(/\/$/, '')}/access/${accessId}`;
}
