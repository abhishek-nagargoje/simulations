-- =============================================================================
-- Access management: configurable lifetime (max 24 h), username-only student
-- sign-in, teacher sign-in rate limiting, SAP ERP in the application catalogue.
--
-- Forward-only and non-destructive. No rows are deleted. The internal table
-- names (app.classes, app.simulations) are kept; they are not user-facing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lifetime: every access session has a duration between 15 minutes and 24 hours.
-- Existing rows keep the 24 hours they were created with.
-- -----------------------------------------------------------------------------
alter table app.classes
  add column if not exists duration_minutes integer not null default 1440;

alter table app.classes drop constraint if exists classes_duration_check;
alter table app.classes
  add constraint classes_duration_check check (duration_minutes between 15 and 1440);

alter table app.classes drop constraint if exists classes_lifecycle_shape;
alter table app.classes add constraint classes_lifecycle_shape check (
    (status = 'draft'   and started_at is null and expires_at is null and closed_at is null)
 or (status = 'active'  and started_at is not null
                        and expires_at = started_at + make_interval(mins => duration_minutes)
                        and closed_at is null)
 or (status = 'closed'  and closed_at is not null
                        and ((started_at is null and expires_at is null)
                          or (started_at is not null and expires_at = started_at + make_interval(mins => duration_minutes))))
 or (status = 'expired' and started_at is not null
                        and expires_at = started_at + make_interval(mins => duration_minutes)
                        and closed_at = expires_at)
);

-- -----------------------------------------------------------------------------
-- Students sign in with username + password only, so a username may belong to
-- at most one open (draft or active) access session at a time. Expired rows are
-- swept first so they do not block the index.
-- -----------------------------------------------------------------------------
select app.sweep_expired();
create unique index if not exists classes_open_username_uidx
  on app.classes (student_username) where status in ('draft', 'active');

-- Failed sign-ins that matched no open session have no class.
alter table app.login_attempts alter column class_id drop not null;
create index if not exists login_attempts_client_idx on app.login_attempts (client_key, attempted_at desc);

-- Teacher sign-in throttling (per client and per account). Stores only HMACs.
create table if not exists app.auth_attempts (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('teacher')),
  client_key   text not null check (length(client_key) = 64),
  account_key  text not null check (length(account_key) = 64),
  succeeded    boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists auth_attempts_client_idx  on app.auth_attempts (kind, client_key, attempted_at desc);
create index if not exists auth_attempts_account_idx on app.auth_attempts (kind, account_key, attempted_at desc);
alter table app.auth_attempts enable row level security;
revoke all on app.auth_attempts from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Application catalogue: HR Remedy HRMS and SAP ERP. Entries without content
-- stay disabled and are not listed.
-- -----------------------------------------------------------------------------
insert into app.simulations (slug, name, description, category, enabled, display_order)
values ('sap-erp', 'SAP ERP',
        'Purchasing, goods receipts, invoice verification, vendor and customer accounting, contract accounting, bank statements and reporting.',
        'Finance & Procurement', true, 2)
on conflict (slug) do update
  set name = excluded.name, description = excluded.description, category = excluded.category,
      display_order = excluded.display_order, updated_at = now();

update app.simulations
   set description = 'Employee management, recruitment, attendance, leave, payroll, performance, employee documents and reports.',
       updated_at = now()
 where slug = 'hr-remedy-hrms';

-- Superseded placeholder entries: keep the rows (history), never offer them.
update app.simulations set enabled = false, updated_at = now()
 where slug in ('zoho-crm', 'sap-finance') and enabled;

-- -----------------------------------------------------------------------------
-- Hook run inside admin_start_class. Replaced by later migrations (the SAP ERP
-- workspace is created here). No-op by default.
-- -----------------------------------------------------------------------------
create or replace function app.after_class_start(p_class_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  return;
end;
$$;
revoke all on function app.after_class_start(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Admin API (re-defined)
-- -----------------------------------------------------------------------------
drop function if exists public.admin_list_classes(uuid);
create function public.admin_list_classes(p_class_id uuid default null)
returns table (
  id uuid, name text, status text,
  simulation_slug text, simulation_name text,
  student_username text, credential_version integer, duration_minutes integer,
  created_by_email text,
  created_at timestamptz, started_at timestamptz, expires_at timestamptz, closed_at timestamptz,
  server_now timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_admin();
  perform app.sweep_expired();
  return query
    select c.id, c.name, app.effective_status(c.status, c.expires_at),
           s.slug, s.name,
           c.student_username, c.credential_version, c.duration_minutes,
           u.email::text,
           c.created_at, c.started_at, c.expires_at, c.closed_at,
           now()
      from app.classes c
      join app.simulations s on s.id = c.simulation_id
      left join auth.users u on u.id = c.created_by
     where p_class_id is null or c.id = p_class_id
     order by c.created_at desc;
end;
$$;

drop function if exists public.admin_create_class(uuid, text, text, text, text);
create or replace function public.admin_create_class(
  p_request_id uuid, p_name text, p_simulation_slug text, p_username text, p_password text,
  p_duration_minutes integer default 1440
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := app.require_admin();
  v_sim_id   uuid;
  v_username text;
  v_name     text := btrim(coalesce(p_name, ''));
  v_id       uuid;
begin
  if p_request_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select c.id into v_id from app.classes c where c.request_id = p_request_id;
  if found then
    return v_id;
  end if;

  if length(v_name) < 3 or length(v_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 15 and 1440 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  v_username := app.validate_username(p_username);
  perform app.validate_password(p_password);

  select s.id into v_sim_id from app.simulations s where s.slug = p_simulation_slug and s.enabled;
  if not found then
    raise exception 'invalid_simulation' using errcode = '22023';
  end if;

  -- Expired sessions must not keep their username reserved.
  perform app.sweep_expired();

  begin
    insert into app.classes (name, simulation_id, created_by, student_username, student_password_hash,
                             request_id, duration_minutes)
    values (v_name, v_sim_id, v_uid, v_username,
            extensions.crypt(p_password, extensions.gen_salt('bf', 10)), p_request_id, p_duration_minutes)
    on conflict (request_id) do nothing
    returning id into v_id;
  exception when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
  end;

  if v_id is null then
    select c.id into v_id from app.classes c where c.request_id = p_request_id;
    return v_id;
  end if;

  insert into app.audit_log (actor_id, action, class_id, details)
  values (v_uid, 'class.created', v_id,
          jsonb_build_object('simulation', p_simulation_slug, 'username', v_username,
                             'duration_minutes', p_duration_minutes));
  return v_id;
end;
$$;

drop function if exists public.admin_start_class(uuid);
create or replace function public.admin_start_class(p_class_id uuid, p_duration_minutes integer default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app.require_admin();
  v_cls app.classes;
  v_now timestamptz := now();
  v_min integer;
begin
  select * into v_cls from app.classes where id = p_class_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_cls.status = 'active' and v_cls.expires_at > v_now then
    return;  -- duplicate start request: already running
  end if;
  if v_cls.status <> 'draft' then
    raise exception 'invalid_state' using errcode = '55000';
  end if;
  if not exists (select 1 from app.simulations s where s.id = v_cls.simulation_id and s.enabled) then
    raise exception 'invalid_simulation' using errcode = '22023';
  end if;
  v_min := coalesce(p_duration_minutes, v_cls.duration_minutes);
  if v_min not between 15 and 1440 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;

  -- Authoritative server timestamp; never extended afterwards.
  update app.classes
     set status = 'active', started_at = v_now, duration_minutes = v_min,
         expires_at = v_now + make_interval(mins => v_min), updated_at = v_now
   where id = p_class_id;

  perform app.after_class_start(p_class_id);

  insert into app.audit_log (actor_id, action, class_id, details)
  values (v_uid, 'class.started', p_class_id,
          jsonb_build_object('expires_at', v_now + make_interval(mins => v_min), 'duration_minutes', v_min));
end;
$$;

-- Credentials can be changed while the session is draft or active (never after).
create or replace function public.admin_rotate_credentials(
  p_class_id uuid, p_username text default null, p_password text default null
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := app.require_admin();
  v_cls      app.classes;
  v_username text;
  v_version  integer;
begin
  if p_username is null and p_password is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select * into v_cls from app.classes where id = p_class_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_cls.status not in ('draft', 'active') or (v_cls.status = 'active' and v_cls.expires_at <= now()) then
    raise exception 'invalid_state' using errcode = '55000';
  end if;

  v_username := case when p_username is null then v_cls.student_username
                     else app.validate_username(p_username) end;
  if p_password is not null then
    perform app.validate_password(p_password);
  end if;

  begin
    update app.classes
       set student_username      = v_username,
           student_password_hash = case when p_password is null then student_password_hash
                                        else extensions.crypt(p_password, extensions.gen_salt('bf', 10)) end,
           credential_version    = credential_version + 1,
           updated_at            = now()
     where id = p_class_id
    returning credential_version into v_version;
  exception when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
  end;

  update app.student_sessions set revoked_at = now()
   where class_id = p_class_id and revoked_at is null;

  insert into app.audit_log (actor_id, action, class_id, details)
  values (v_uid, 'class.credentials_rotated', p_class_id,
          jsonb_build_object('username_changed', v_username <> v_cls.student_username,
                             'password_changed', p_password is not null,
                             'credential_version', v_version));
  return v_version;
end;
$$;

-- -----------------------------------------------------------------------------
-- Student API (service_role only)
-- -----------------------------------------------------------------------------

-- Sign-in without a link: the username identifies the open access session.
-- Returns the outcome and, on success only, the session (class) id.
create or replace function public.student_login_by_username(
  p_username text, p_password text, p_client_key text, p_token_hash text,
  p_session_ttl_seconds integer default 28800
)
returns table (outcome text, class_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_cls      app.classes;
  v_now      timestamptz := now();
  v_failures integer;
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_ok       boolean;
begin
  if p_client_key is null or length(p_client_key) <> 64
     or p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- 10 failures per client in 15 minutes, across all access sessions.
  select count(*) into v_failures from app.login_attempts a
   where a.client_key = p_client_key and not a.succeeded and a.attempted_at > v_now - interval '15 minutes';
  if v_failures >= 10 then
    return query select 'rate_limited'::text, null::uuid;
    return;
  end if;

  select * into v_cls from app.classes c
   where c.student_username = v_username and c.status in ('draft', 'active')
   for share;

  if not found then
    -- Constant-cost comparison so unknown usernames take as long as wrong passwords.
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
    insert into app.login_attempts (class_id, client_key, succeeded) values (null, p_client_key, false);
    return query select 'invalid_credentials'::text, null::uuid;
    return;
  end if;

  select count(*) into v_failures from app.login_attempts a
   where a.class_id = v_cls.id and not a.succeeded and a.attempted_at > v_now - interval '15 minutes';
  if v_failures >= 300 then
    return query select 'rate_limited'::text, null::uuid;
    return;
  end if;

  v_ok := p_password is not null
          and v_cls.student_password_hash = extensions.crypt(p_password, v_cls.student_password_hash);
  insert into app.login_attempts (class_id, client_key, succeeded) values (v_cls.id, p_client_key, v_ok);
  if not v_ok then
    return query select 'invalid_credentials'::text, null::uuid;
    return;
  end if;

  -- Only correct credentials reveal the session's state.
  if v_cls.status = 'draft' then
    return query select 'not_started'::text, null::uuid;
    return;
  end if;
  if v_cls.expires_at <= v_now then
    return query select 'expired'::text, null::uuid;
    return;
  end if;

  insert into app.student_sessions (class_id, token_hash, credential_version, expires_at)
  values (v_cls.id, p_token_hash, v_cls.credential_version,
          least(v_now + make_interval(secs => greatest(60, least(p_session_ttl_seconds, 86400))),
                v_cls.expires_at));
  return query select 'ok'::text, v_cls.id;
end;
$$;

-- Public, non-secret facts for the access-link sign-in page.
create or replace function public.student_access_info(p_class_id uuid)
returns table (status text, app_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
    select app.effective_status(c.status, c.expires_at),
           case when app.effective_status(c.status, c.expires_at) = 'active' then s.name end
      from app.classes c
      join app.simulations s on s.id = c.simulation_id
     where c.id = p_class_id;
end;
$$;

-- Teacher sign-in throttle: 10 failures per client or 8 per account in 15 min.
create or replace function public.auth_check_rate(p_kind text, p_client_key text, p_account_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select count(*) from app.auth_attempts a
           where a.kind = p_kind and a.client_key = p_client_key and not a.succeeded
             and a.attempted_at > now() - interval '15 minutes') < 10
     and (select count(*) from app.auth_attempts a
           where a.kind = p_kind and a.account_key = p_account_key and not a.succeeded
             and a.attempted_at > now() - interval '15 minutes') < 8;
$$;

create or replace function public.auth_record_attempt(p_kind text, p_client_key text, p_account_key text, p_succeeded boolean)
returns void
language sql security definer set search_path = ''
as $$
  insert into app.auth_attempts (kind, client_key, account_key, succeeded)
  values (p_kind, p_client_key, p_account_key, p_succeeded);
  delete from app.auth_attempts where attempted_at < now() - interval '7 days';
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.admin_list_classes(uuid)                                    from public, anon, authenticated, service_role;
revoke all on function public.admin_create_class(uuid, text, text, text, text, integer)   from public, anon, authenticated, service_role;
revoke all on function public.admin_start_class(uuid, integer)                            from public, anon, authenticated, service_role;
revoke all on function public.admin_rotate_credentials(uuid, text, text)                  from public, anon, authenticated, service_role;
revoke all on function public.student_login_by_username(text, text, text, text, integer)  from public, anon, authenticated, service_role;
revoke all on function public.student_access_info(uuid)                                    from public, anon, authenticated, service_role;
revoke all on function public.auth_check_rate(text, text, text)                           from public, anon, authenticated, service_role;
revoke all on function public.auth_record_attempt(text, text, text, boolean)              from public, anon, authenticated, service_role;

grant execute on function public.admin_list_classes(uuid)                                  to authenticated;
grant execute on function public.admin_create_class(uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.admin_start_class(uuid, integer)                          to authenticated;
grant execute on function public.admin_rotate_credentials(uuid, text, text)                to authenticated;
grant execute on function public.student_login_by_username(text, text, text, text, integer) to service_role;
grant execute on function public.student_access_info(uuid)                                 to service_role;
grant execute on function public.auth_check_rate(text, text, text)                         to service_role;
grant execute on function public.auth_record_attempt(text, text, text, boolean)            to service_role;
