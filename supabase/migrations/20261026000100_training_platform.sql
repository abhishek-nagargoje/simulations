-- =============================================================================
-- Simulation Training Platform — initial schema
--
-- Forward-only, non-destructive. Uses IF NOT EXISTS / CREATE OR REPLACE so the
-- migration can be re-run safely. Never drops or truncates data.
--
-- Security model
--   * All tables live in the private `app` schema, which is NOT exposed through
--     the Supabase Data API. RLS is enabled on every table with no policies, so
--     even if the schema were exposed, anon/authenticated could read nothing.
--   * The browser never touches tables. All access goes through narrowly scoped
--     SECURITY DEFINER functions in `public`:
--       - admin_*   : EXECUTE granted to `authenticated` only; each call
--                     re-checks app.admin_roles for auth.uid().
--       - student_* : EXECUTE granted to `service_role` only (called from the
--                     Next.js server with the secret key, never from browsers).
--   * Student passwords are bcrypt hashes (pgcrypto crypt / gen_salt('bf')).
--     Student session tokens are stored only as HMAC-SHA256 hashes computed by
--     the server; the raw token lives only in an HttpOnly cookie.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
revoke all on schema app from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists app.admin_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'admin' check (role in ('admin')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null
);

create table if not exists app.simulations (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  name          text not null check (length(btrim(name)) between 2 and 120),
  description   text not null default '',
  enabled       boolean not null default true,
  display_order integer not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists app.classes (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (length(btrim(name)) between 3 and 120),
  simulation_id         uuid not null references app.simulations (id),
  status                text not null default 'draft'
                        check (status in ('draft', 'active', 'closed', 'expired')),
  created_by            uuid references auth.users (id) on delete set null,
  student_username      text not null check (student_username ~ '^[a-z0-9._-]{3,40}$'),
  student_password_hash text not null,
  credential_version    integer not null default 1 check (credential_version >= 1),
  request_id            uuid unique,               -- idempotency key for creation
  created_at            timestamptz not null default now(),
  started_at            timestamptz,
  expires_at            timestamptz,
  closed_at             timestamptz,
  updated_at            timestamptz not null default now(),
  -- Lifecycle shape. Draft: never started. Active: started, 24h window, open.
  -- Closed: either a discarded draft or a started class ended by the teacher.
  -- Expired: started class whose 24h window elapsed (closed_at = expires_at).
  constraint classes_lifecycle_shape check (
    (status = 'draft'   and started_at is null and expires_at is null and closed_at is null)
 or (status = 'active'  and started_at is not null
                        and expires_at = started_at + interval '24 hours'
                        and closed_at is null)
 or (status = 'closed'  and closed_at is not null
                        and ((started_at is null and expires_at is null)
                          or (started_at is not null and expires_at = started_at + interval '24 hours')))
 or (status = 'expired' and started_at is not null
                        and expires_at = started_at + interval '24 hours'
                        and closed_at = expires_at)
  )
);

create index if not exists classes_status_expires_idx on app.classes (status, expires_at);
create index if not exists classes_created_by_idx     on app.classes (created_by);
create index if not exists classes_simulation_idx     on app.classes (simulation_id);
create index if not exists classes_created_at_idx     on app.classes (created_at desc);

create table if not exists app.student_sessions (
  id                 uuid primary key default gen_random_uuid(),
  class_id           uuid not null references app.classes (id) on delete cascade,
  token_hash         text not null unique check (length(token_hash) = 64),
  credential_version integer not null,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  revoked_at         timestamptz
);
create index if not exists student_sessions_class_idx on app.student_sessions (class_id);

create table if not exists app.login_attempts (
  id           bigint generated always as identity primary key,
  class_id     uuid not null references app.classes (id) on delete cascade,
  client_key   text not null check (length(client_key) = 64),  -- HMAC of client IP, never the IP
  succeeded    boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists login_attempts_lookup_idx
  on app.login_attempts (class_id, client_key, attempted_at desc);
create index if not exists login_attempts_age_idx on app.login_attempts (attempted_at);

create table if not exists app.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null,
  class_id   uuid references app.classes (id) on delete set null,
  details    jsonb not null default '{}'::jsonb,   -- never contains passwords/hashes/tokens
  created_at timestamptz not null default now()
);
create index if not exists audit_log_class_idx   on app.audit_log (class_id, created_at desc);
create index if not exists audit_log_created_idx on app.audit_log (created_at desc);

alter table app.admin_roles      enable row level security;
alter table app.simulations      enable row level security;
alter table app.classes          enable row level security;
alter table app.student_sessions enable row level security;
alter table app.login_attempts   enable row level security;
alter table app.audit_log        enable row level security;

revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;

-- Seed catalogue (idempotent; does not overwrite edits made later).
insert into app.simulations (slug, name, description, display_order) values
  ('zoho-crm',    'Zoho CRM',    'Hands-on CRM practice: leads, contacts, deals, pipelines and activities.', 10),
  ('sap-finance', 'SAP Finance', 'SAP FI practice: general ledger, accounts payable/receivable and postings.', 20)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- Internal helpers (schema app — not callable through the API)
-- -----------------------------------------------------------------------------

create or replace function app.is_admin(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user is not null and exists (select 1 from app.admin_roles r where r.user_id = p_user);
$$;

create or replace function app.require_admin()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not app.is_admin(v_uid) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function app.validate_username(p_username text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_username, '')));
begin
  if v !~ '^[a-z0-9._-]{3,40}$' then
    raise exception 'invalid_username' using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function app.validate_password(p_password text)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  -- Password is used exactly as supplied (no trimming / case folding).
  if p_password is null or length(p_password) < 8 or length(p_password) > 72 then
    raise exception 'invalid_password' using errcode = '22023';
  end if;
end;
$$;

-- Marks every active class whose 24h window has elapsed as expired and revokes
-- its sessions. Supplementary only: every authorization check compares
-- now() with expires_at directly, so correctness never depends on this sweep.
create or replace function app.sweep_expired()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update app.classes c
       set status = 'expired', closed_at = c.expires_at, updated_at = now()
     where c.status = 'active' and c.expires_at <= now()
    returning c.id
  ), revoked as (
    update app.student_sessions s
       set revoked_at = now()
     where s.class_id in (select id from expired) and s.revoked_at is null
    returning 1
  )
  select count(*) into v_count from expired;

  delete from app.login_attempts where attempted_at < now() - interval '7 days';
  delete from app.student_sessions where expires_at < now() - interval '7 days';
  return v_count;
end;
$$;

create or replace function app.effective_status(p_status text, p_expires_at timestamptz)
returns text
language sql stable set search_path = ''
as $$
  select case when p_status = 'active' and p_expires_at <= now() then 'expired' else p_status end;
$$;

-- -----------------------------------------------------------------------------
-- Admin API (authenticated + admin role)
-- -----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_admin(auth.uid());
$$;

create or replace function public.admin_list_simulations()
returns table (id uuid, slug text, name text, description text, enabled boolean, display_order integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.require_admin();
  return query
    select s.id, s.slug, s.name, s.description, s.enabled, s.display_order
      from app.simulations s
     order by s.display_order, s.name;
end;
$$;

-- Non-secret projection of a class. Never includes the password hash.
create or replace function public.admin_list_classes(p_class_id uuid default null)
returns table (
  id uuid, name text, status text,
  simulation_slug text, simulation_name text,
  student_username text, credential_version integer,
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
           c.student_username, c.credential_version,
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

create or replace function public.admin_create_class(
  p_request_id uuid, p_name text, p_simulation_slug text, p_username text, p_password text
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

  -- Idempotency: a retried request returns the class it already created.
  select c.id into v_id from app.classes c where c.request_id = p_request_id;
  if found then
    return v_id;
  end if;

  if length(v_name) < 3 or length(v_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  v_username := app.validate_username(p_username);
  perform app.validate_password(p_password);

  select s.id into v_sim_id from app.simulations s where s.slug = p_simulation_slug and s.enabled;
  if not found then
    raise exception 'invalid_simulation' using errcode = '22023';
  end if;

  insert into app.classes (name, simulation_id, created_by, student_username, student_password_hash, request_id)
  values (v_name, v_sim_id, v_uid, v_username,
          extensions.crypt(p_password, extensions.gen_salt('bf', 10)), p_request_id)
  on conflict (request_id) do nothing
  returning id into v_id;

  if v_id is null then  -- lost a race with an identical concurrent request
    select c.id into v_id from app.classes c where c.request_id = p_request_id;
    return v_id;
  end if;

  insert into app.audit_log (actor_id, action, class_id, details)
  values (v_uid, 'class.created', v_id,
          jsonb_build_object('simulation', p_simulation_slug, 'username', v_username));
  return v_id;
end;
$$;

create or replace function public.admin_start_class(p_class_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app.require_admin();
  v_cls app.classes;
  v_now timestamptz := now();
begin
  select * into v_cls from app.classes where id = p_class_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_cls.status = 'active' and v_cls.expires_at > v_now then
    return;  -- duplicate start request: already running, nothing to do
  end if;
  if v_cls.status <> 'draft' then
    raise exception 'invalid_state' using errcode = '55000';
  end if;
  if not exists (select 1 from app.simulations s where s.id = v_cls.simulation_id and s.enabled) then
    raise exception 'invalid_simulation' using errcode = '22023';
  end if;

  update app.classes
     set status = 'active', started_at = v_now, expires_at = v_now + interval '24 hours',
         updated_at = v_now
   where id = p_class_id;

  insert into app.audit_log (actor_id, action, class_id, details)
  values (v_uid, 'class.started', p_class_id,
          jsonb_build_object('expires_at', v_now + interval '24 hours'));
end;
$$;

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
  -- Rotation never reactivates a class: only running, unexpired classes qualify.
  if v_cls.status <> 'active' or v_cls.expires_at <= now() then
    raise exception 'invalid_state' using errcode = '55000';
  end if;

  v_username := case when p_username is null then v_cls.student_username
                     else app.validate_username(p_username) end;
  if p_password is not null then
    perform app.validate_password(p_password);
  end if;

  update app.classes
     set student_username      = v_username,
         student_password_hash = case when p_password is null then student_password_hash
                                      else extensions.crypt(p_password, extensions.gen_salt('bf', 10)) end,
         credential_version    = credential_version + 1,
         updated_at            = now()
   where id = p_class_id
  returning credential_version into v_version;

  update app.student_sessions set revoked_at = now()
   where class_id = p_class_id and revoked_at is null;

  insert into app.audit_log (actor_id, action, class_id, details)
  values (v_uid, 'class.credentials_rotated', p_class_id,
          jsonb_build_object('username_changed', p_username is not null and v_username <> v_cls.student_username,
                             'password_changed', p_password is not null,
                             'credential_version', v_version));
  return v_version;
end;
$$;

create or replace function public.admin_close_class(p_class_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app.require_admin();
  v_cls app.classes;
begin
  select * into v_cls from app.classes where id = p_class_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_cls.status in ('closed', 'expired') then
    return v_cls.status;  -- idempotent
  end if;

  if v_cls.status = 'active' and v_cls.expires_at <= now() then
    update app.classes set status = 'expired', closed_at = expires_at, updated_at = now()
     where id = p_class_id;
    update app.student_sessions set revoked_at = now()
     where class_id = p_class_id and revoked_at is null;
    return 'expired';
  end if;

  update app.classes
     set status = 'closed', closed_at = now(),
         credential_version = credential_version + 1, updated_at = now()
   where id = p_class_id;

  update app.student_sessions set revoked_at = now()
   where class_id = p_class_id and revoked_at is null;

  insert into app.audit_log (actor_id, action, class_id, details)
  values (v_uid, 'class.closed', p_class_id, jsonb_build_object('previous_status', v_cls.status));
  return 'closed';
end;
$$;

create or replace function public.admin_list_audit(p_class_id uuid)
returns table (id bigint, action text, actor_email text, details jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.require_admin();
  return query
    select a.id, a.action, u.email::text, a.details, a.created_at
      from app.audit_log a
      left join auth.users u on u.id = a.actor_id
     where a.class_id = p_class_id
     order by a.created_at desc
     limit 100;
end;
$$;

-- -----------------------------------------------------------------------------
-- Student API (service_role only — called by the Next.js server)
-- -----------------------------------------------------------------------------

-- Public, non-secret facts about a classroom for the login page.
create or replace function public.student_class_info(p_class_id uuid)
returns table (status text, class_name text, simulation_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
    select app.effective_status(c.status, c.expires_at),
           case when app.effective_status(c.status, c.expires_at) = 'active' then c.name end,
           case when app.effective_status(c.status, c.expires_at) = 'active' then s.name end
      from app.classes c
      join app.simulations s on s.id = c.simulation_id
     where c.id = p_class_id;
end;
$$;

-- Returns one of: ok, invalid_credentials, rate_limited, not_found,
-- not_started, closed, expired.
create or replace function public.student_login(
  p_class_id uuid, p_username text, p_password text, p_client_key text, p_token_hash text,
  p_session_ttl_seconds integer default 28800
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_cls      app.classes;
  v_now      timestamptz := now();
  v_failures integer;
  v_ok       boolean;
begin
  if p_client_key is null or length(p_client_key) <> 64
     or p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- FOR SHARE serialises with close/rotate (which take FOR UPDATE), so a login
  -- can never mint a session against credentials that were just revoked.
  select * into v_cls from app.classes where id = p_class_id for share;
  if not found then
    return 'not_found';
  end if;
  if v_cls.status = 'draft' then return 'not_started'; end if;
  if v_cls.status = 'closed' then return 'closed'; end if;
  if v_cls.status = 'expired' or v_cls.expires_at <= v_now then return 'expired'; end if;

  -- Rate limit: 10 failures per client per class per 15 min, 300 per class.
  select count(*) into v_failures from app.login_attempts
   where class_id = p_class_id and client_key = p_client_key
     and not succeeded and attempted_at > v_now - interval '15 minutes';
  if v_failures >= 10 then return 'rate_limited'; end if;
  select count(*) into v_failures from app.login_attempts
   where class_id = p_class_id and not succeeded and attempted_at > v_now - interval '15 minutes';
  if v_failures >= 300 then return 'rate_limited'; end if;

  v_ok := v_cls.student_username = lower(btrim(coalesce(p_username, '')))
          and p_password is not null
          and v_cls.student_password_hash = extensions.crypt(p_password, v_cls.student_password_hash);

  insert into app.login_attempts (class_id, client_key, succeeded) values (p_class_id, p_client_key, v_ok);
  if not v_ok then
    return 'invalid_credentials';
  end if;

  insert into app.student_sessions (class_id, token_hash, credential_version, expires_at)
  values (p_class_id, p_token_hash, v_cls.credential_version,
          least(v_now + make_interval(secs => greatest(60, least(p_session_ttl_seconds, 86400))),
                v_cls.expires_at));
  return 'ok';
end;
$$;

-- Authoritative per-request check. reason is one of: ok, no_session, revoked,
-- session_expired, closed, expired, not_started.
create or replace function public.student_validate_session(p_class_id uuid, p_token_hash text)
returns table (
  valid boolean, reason text, class_name text, simulation_slug text, simulation_name text,
  class_expires_at timestamptz, session_expires_at timestamptz, server_now timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_now  timestamptz := now();
  v_sess app.student_sessions;
  v_cls  app.classes;
  v_sim  app.simulations;
  v_reason text;
begin
  select * into v_sess from app.student_sessions s
   where s.token_hash = p_token_hash and s.class_id = p_class_id;
  if not found then
    return query select false, 'no_session'::text, null::text, null::text, null::text,
                        null::timestamptz, null::timestamptz, v_now;
    return;
  end if;

  select * into v_cls from app.classes c where c.id = v_sess.class_id;
  select * into v_sim from app.simulations s where s.id = v_cls.simulation_id;

  v_reason := case
    when v_cls.status = 'closed' then 'closed'
    when v_cls.status = 'expired' or v_cls.expires_at <= v_now then 'expired'
    when v_cls.status <> 'active' then 'not_started'
    when v_sess.revoked_at is not null
      or v_sess.credential_version <> v_cls.credential_version then 'revoked'
    when v_sess.expires_at <= v_now then 'session_expired'
    when not v_sim.enabled then 'closed'
    else 'ok'
  end;

  return query select v_reason = 'ok', v_reason,
                      case when v_reason = 'ok' then v_cls.name end,
                      case when v_reason = 'ok' then v_sim.slug end,
                      case when v_reason = 'ok' then v_sim.name end,
                      case when v_reason = 'ok' then v_cls.expires_at end,
                      case when v_reason = 'ok' then v_sess.expires_at end,
                      v_now;
end;
$$;

create or replace function public.student_logout(p_class_id uuid, p_token_hash text)
returns void
language sql security definer set search_path = ''
as $$
  update app.student_sessions set revoked_at = now()
   where class_id = p_class_id and token_hash = p_token_hash and revoked_at is null;
$$;

-- Trusted bootstrap: grants the admin role to an existing Supabase Auth user.
create or replace function public.bootstrap_admin(p_email text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
begin
  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(p_email));
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into app.admin_roles (user_id) values (v_uid) on conflict (user_id) do nothing;
  insert into app.audit_log (actor_id, action, details)
  values (null, 'admin.role_granted', jsonb_build_object('user_id', v_uid));
  return v_uid;
end;
$$;

create or replace function public.expire_classes()
returns integer
language sql security definer set search_path = ''
as $$
  select app.sweep_expired();
$$;

-- -----------------------------------------------------------------------------
-- Grants. Supabase grants EXECUTE on new public functions to anon,
-- authenticated and service_role by default, so revoke explicitly first.
-- -----------------------------------------------------------------------------

revoke all on function app.is_admin(uuid)                     from public, anon, authenticated;
revoke all on function app.require_admin()                    from public, anon, authenticated;
revoke all on function app.validate_username(text)            from public, anon, authenticated;
revoke all on function app.validate_password(text)            from public, anon, authenticated;
revoke all on function app.sweep_expired()                    from public, anon, authenticated;
revoke all on function app.effective_status(text, timestamptz) from public, anon, authenticated;

revoke all on function public.is_admin()                                         from public, anon, authenticated, service_role;
revoke all on function public.admin_list_simulations()                           from public, anon, authenticated, service_role;
revoke all on function public.admin_list_classes(uuid)                           from public, anon, authenticated, service_role;
revoke all on function public.admin_create_class(uuid, text, text, text, text)   from public, anon, authenticated, service_role;
revoke all on function public.admin_start_class(uuid)                            from public, anon, authenticated, service_role;
revoke all on function public.admin_rotate_credentials(uuid, text, text)         from public, anon, authenticated, service_role;
revoke all on function public.admin_close_class(uuid)                            from public, anon, authenticated, service_role;
revoke all on function public.admin_list_audit(uuid)                             from public, anon, authenticated, service_role;
revoke all on function public.student_class_info(uuid)                           from public, anon, authenticated, service_role;
revoke all on function public.student_login(uuid, text, text, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.student_validate_session(uuid, text)               from public, anon, authenticated, service_role;
revoke all on function public.student_logout(uuid, text)                         from public, anon, authenticated, service_role;
revoke all on function public.bootstrap_admin(text)                              from public, anon, authenticated, service_role;
revoke all on function public.expire_classes()                                   from public, anon, authenticated, service_role;

grant execute on function public.is_admin()                                       to authenticated;
grant execute on function public.admin_list_simulations()                         to authenticated;
grant execute on function public.admin_list_classes(uuid)                         to authenticated;
grant execute on function public.admin_create_class(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_start_class(uuid)                          to authenticated;
grant execute on function public.admin_rotate_credentials(uuid, text, text)       to authenticated;
grant execute on function public.admin_close_class(uuid)                          to authenticated;
grant execute on function public.admin_list_audit(uuid)                           to authenticated;

grant execute on function public.student_class_info(uuid)                             to service_role;
grant execute on function public.student_login(uuid, text, text, text, text, integer) to service_role;
grant execute on function public.student_validate_session(uuid, text)                 to service_role;
grant execute on function public.student_logout(uuid, text)                           to service_role;
grant execute on function public.bootstrap_admin(text)                                to service_role;
grant execute on function public.expire_classes()                                     to service_role;
