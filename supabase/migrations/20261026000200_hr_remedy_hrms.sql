-- =============================================================================
-- HR Remedy HRMS becomes the first simulation in the catalogue.
-- Forward-only and idempotent. Adds a nullable-with-default column, upserts one
-- catalogue row and updates display metadata. No data is deleted.
-- =============================================================================

alter table app.simulations add column if not exists category text not null default 'General';

insert into app.simulations (slug, name, description, category, enabled, display_order)
values (
  'hr-remedy-hrms',
  'HR Remedy HRMS',
  'An interactive Human Resource Management System simulation for practicing employee management, recruitment, attendance, leave management, payroll, performance management, employee documents, reporting, and other HR workflows.',
  'Human Resources',
  true,
  1
)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      display_order = excluded.display_order,
      updated_at = now();

update app.simulations set category = 'CRM',     display_order = 20, updated_at = now() where slug = 'zoho-crm'    and category = 'General';
update app.simulations set category = 'Finance', display_order = 30, updated_at = now() where slug = 'sap-finance' and category = 'General';

-- Zoho CRM and SAP Finance have no simulation content yet. Disable them in the
-- catalogue unless a class already uses them (never break existing records).
update app.simulations s
   set enabled = false, updated_at = now()
 where s.slug in ('zoho-crm', 'sap-finance')
   and s.enabled
   and not exists (select 1 from app.classes c where c.simulation_id = s.id);

-- Return type changes (adds category), so the function must be recreated.
drop function if exists public.admin_list_simulations();

create function public.admin_list_simulations()
returns table (id uuid, slug text, name text, description text, category text, enabled boolean, display_order integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.require_admin();
  return query
    select s.id, s.slug, s.name, s.description, s.category, s.enabled, s.display_order
      from app.simulations s
     order by s.display_order, s.name;
end;
$$;

revoke all on function public.admin_list_simulations() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_simulations() to authenticated;
