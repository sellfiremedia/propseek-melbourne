-- =====================================================================
--  PropSeek Landing Admin — Supabase setup
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run again (it drops & recreates functions/policies, keeps data).
-- =====================================================================

create extension if not exists pg_net;   -- lets the database call n8n webhooks

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  k text primary key,
  v jsonb
);

create table if not exists public.admins (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id             bigint generated always as identity primary key,
  first_name     text not null,
  last_name      text not null,
  email          text not null,
  mobile         text not null,
  seats          int  not null default 1,
  super_balance  text not null default '',
  status         text not null default 'new',
  notes          text not null default '',
  event_name     text not null default '',
  event_date     text not null default '',
  event_location text not null default '',
  page_url       text not null default '',
  referrer       text not null default '',
  utm_source     text not null default '',
  utm_medium     text not null default '',
  utm_campaign   text not null default '',
  utm_content    text not null default '',
  utm_term       text not null default '',
  fbclid         text not null default '',
  gclid          text not null default '',
  visitor_id     text not null default '',
  event_id       text not null default '',
  user_timezone  text not null default '',
  ip             text not null default '',
  user_agent     text not null default '',
  device         text not null default '',
  is_duplicate   boolean not null default false,
  n8n_status     text not null default 'pending',
  n8n_request_id bigint,
  n8n_code       int,
  n8n_response   text,
  n8n_sent_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint leads_first_name_chk check (char_length(first_name) between 1 and 100),
  constraint leads_last_name_chk  check (char_length(last_name)  between 1 and 100),
  constraint leads_email_chk      check (char_length(email) <= 190 and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  constraint leads_mobile_chk     check (mobile ~ '^04[0-9]{8}$'),
  constraint leads_seats_chk      check (seats between 1 and 10)
);
create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_status_idx  on public.leads (status);
create index if not exists leads_email_idx   on public.leads (email);
create index if not exists leads_mobile_idx  on public.leads (mobile);
create index if not exists leads_ip_idx      on public.leads (ip, created_at);

create table if not exists public.lead_activity (
  id         bigint generated always as identity primary key,
  lead_id    bigint not null references public.leads(id) on delete cascade,
  action     text not null,
  detail     text not null default '',
  username   text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists lead_activity_lead_idx on public.lead_activity (lead_id);

create table if not exists public.events (
  id           bigint generated always as identity primary key,
  type         text not null,
  visitor_id   text not null,
  session_id   text not null default '',
  label        text not null default '',
  page         text not null default '',
  referrer     text not null default '',
  utm_source   text not null default '',
  utm_medium   text not null default '',
  utm_campaign text not null default '',
  device       text not null default '',
  browser      text not null default '',
  created_at   timestamptz not null default now(),
  constraint events_type_chk check (type in ('pageview','cta_click','form_start','form_submit','form_error','scroll_50','scroll_90','engaged_30s','lead')),
  constraint events_vid_chk  check (char_length(visitor_id) between 1 and 64)
);
create index if not exists events_type_created_idx on public.events (type, created_at);
create index if not exists events_visitor_idx      on public.events (visitor_id, created_at);
create index if not exists events_created_idx      on public.events (created_at);

-- default settings (only inserted if missing)
insert into public.settings (k, v) values
  ('n8n_webhook_url',        '""'),
  ('n8n_status_webhook_url', '""'),
  ('meta_pixel_id',          '""'),
  ('timezone',               '"Australia/Melbourne"'),
  ('event_capacity',         '0'),
  ('statuses', '[
     {"key":"new","label":"New","color":"#3b82f6"},
     {"key":"contacted","label":"Contacted","color":"#f59e0b"},
     {"key":"confirmed","label":"Confirmed","color":"#10b981"},
     {"key":"attended","label":"Attended","color":"#8b5cf6"},
     {"key":"no_show","label":"No show","color":"#ef4444"},
     {"key":"not_interested","label":"Not interested","color":"#6b7280"}]')
on conflict (k) do nothing;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.setting(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(v #>> '{}', '') from public.settings where k = p_key
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

create or replace function public.req_header(p_name text) returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> p_name, '')
$$;

create or replace function public.client_ip() returns text
language sql stable as $$
  select left(coalesce(nullif(public.req_header('cf-connecting-ip'), ''),
                       nullif(trim(split_part(public.req_header('x-forwarded-for'), ',', 1)), ''), ''), 45)
$$;

create or replace function public.device_from_ua(ua text) returns text
language sql immutable as $$
  select case
    when ua ~* '(ipad|tablet|kindle|silk|playbook)' or (ua ~* 'android' and ua !~* 'mobile') then 'Tablet'
    when ua ~* '(mobi|iphone|ipod|android|blackberry|opera mini|iemobile)' then 'Mobile'
    when ua = '' then ''
    else 'Desktop' end
$$;

create or replace function public.browser_from_ua(ua text) returns text
language sql immutable as $$
  select case
    when ua ~ '(FBAN|FBAV)' then 'Facebook app'
    when ua ~ 'Instagram' then 'Instagram app'
    when ua ~ 'Edg/' then 'Edge'
    when ua ~ 'OPR/' then 'Opera'
    when ua ~ 'SamsungBrowser' then 'Samsung'
    when ua ~ '(CriOS|Chrome/)' then 'Chrome'
    when ua ~ '(FxiOS|Firefox/)' then 'Firefox'
    when ua ~ 'Safari/' then 'Safari'
    else 'Other' end
$$;

create or replace function public.is_bot(ua text) returns boolean
language sql immutable as $$
  select ua = '' or ua ~* '(bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|curl|wget|python)'
$$;

create or replace function public.source_label(p_utm text, p_ref text, p_fbclid text, p_gclid text) returns text
language sql immutable as $$
  select case
    when coalesce(p_utm, '') <> '' then lower(p_utm)
    when coalesce(p_fbclid, '') <> '' then 'facebook'
    when coalesce(p_gclid, '') <> '' then 'google ads'
    when coalesce(p_ref, '') = '' then 'direct'
    else (
      with h as (select regexp_replace(lower(substring(p_ref from '^[a-z]+://([^/:?#]+)')), '^(www\.|m\.|l\.|lm\.)', '') as host)
      select case
        when host is null or host = '' then 'direct'
        when host like '%facebook%' or host like 'fb.%' then 'facebook'
        when host like '%instagram%' then 'instagram'
        when host like '%google%' then 'google'
        else host end
      from h)
  end
$$;

create or replace function public.status_label(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select s ->> 'label' from public.settings, jsonb_array_elements(v) s
                   where k = 'statuses' and s ->> 'key' = p_key limit 1), p_key)
$$;

-- JSON sent to n8n for a lead
create or replace function public.lead_payload(l public.leads) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'lead_id', l.id, 'first_name', l.first_name, 'last_name', l.last_name,
    'full_name', l.first_name || ' ' || l.last_name, 'email', l.email, 'mobile', l.mobile,
    'mobile_intl', '+61' || substr(l.mobile, 2), 'seats', l.seats, 'super_balance', l.super_balance,
    'status', l.status, 'status_label', public.status_label(l.status), 'notes', l.notes, 'consent', 'yes',
    'event', l.event_name, 'event_date', l.event_date, 'event_location', l.event_location,
    'source', public.source_label(l.utm_source, l.referrer, l.fbclid, l.gclid),
    'page_url', l.page_url, 'referrer', l.referrer,
    'utm_source', l.utm_source, 'utm_medium', l.utm_medium, 'utm_campaign', l.utm_campaign,
    'utm_content', l.utm_content, 'utm_term', l.utm_term, 'fbclid', l.fbclid, 'gclid', l.gclid,
    'event_id', l.event_id, 'device', l.device, 'is_duplicate', l.is_duplicate,
    'submitted_at', to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'submitted_at_local', to_char(l.created_at at time zone coalesce(nullif(public.setting('timezone'), ''), 'UTC'), 'YYYY-MM-DD HH24:MI'),
    'user_timezone', l.user_timezone, 'client_ip', l.ip, 'user_agent', l.user_agent)
$$;

create or replace function public.log_activity(p_lead bigint, p_action text, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into public.lead_activity (lead_id, action, detail, username)
  values (p_lead, p_action, left(p_detail, 500), coalesce(auth.jwt() ->> 'email', 'system'))
$$;

-- Queue a lead to n8n (pg_net is asynchronous; result is read by refresh_n8n_status)
create or replace function public.send_lead_to_n8n(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_url text := public.setting('n8n_webhook_url');
  v_lead public.leads;
  v_req bigint;
begin
  select * into v_lead from public.leads where id = p_id;
  if not found then return 'not_found'; end if;
  if v_url = '' then
    update public.leads set n8n_status = 'skipped', n8n_response = 'No n8n webhook URL set' where id = p_id;
    return 'skipped';
  end if;
  select net.http_post(url := v_url,
                       body := jsonb_build_object('type', 'new_lead') || public.lead_payload(v_lead),
                       headers := '{"Content-Type":"application/json"}'::jsonb,
                       timeout_milliseconds := 8000) into v_req;
  update public.leads set n8n_status = 'queued', n8n_request_id = v_req, n8n_code = null,
                          n8n_response = null, n8n_sent_at = now() where id = p_id;
  return 'queued';
end $$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function public.leads_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ua text := left(public.req_header('user-agent'), 500);
begin
  -- clean / normalise
  new.first_name := left(trim(new.first_name), 100);
  new.last_name  := left(trim(new.last_name), 100);
  new.email      := lower(trim(new.email));
  new.mobile     := regexp_replace(coalesce(new.mobile, ''), '[^0-9]', '', 'g');
  if new.mobile ~ '^61[0-9]{9}$' then new.mobile := '0' || substr(new.mobile, 3); end if;
  new.super_balance := left(coalesce(new.super_balance, ''), 60);
  new.event_name := left(new.event_name, 190); new.event_date := left(new.event_date, 60);
  new.event_location := left(new.event_location, 120);
  new.page_url := left(new.page_url, 500);  new.referrer := left(new.referrer, 500);
  new.utm_source := left(new.utm_source, 120); new.utm_medium := left(new.utm_medium, 120);
  new.utm_campaign := left(new.utm_campaign, 190); new.utm_content := left(new.utm_content, 190);
  new.utm_term := left(new.utm_term, 190); new.fbclid := left(new.fbclid, 255); new.gclid := left(new.gclid, 255);
  new.visitor_id := left(new.visitor_id, 64); new.event_id := left(regexp_replace(new.event_id, '[^a-zA-Z0-9_-]', '', 'g'), 64);
  new.user_timezone := left(new.user_timezone, 60);
  -- server-controlled fields (the public can't set these)
  new.status := 'new'; new.notes := ''; new.n8n_status := 'pending';
  new.n8n_request_id := null; new.n8n_code := null; new.n8n_response := null; new.n8n_sent_at := null;
  new.created_at := now(); new.updated_at := now();
  new.ip := public.client_ip();
  new.user_agent := v_ua;
  new.device := public.device_from_ua(v_ua);

  -- rate limit: 5 submissions per IP per 10 minutes
  if new.ip <> '' and (select count(*) from public.leads where ip = new.ip and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many submissions. Please try again later.' using errcode = 'P0001';
  end if;

  new.is_duplicate := exists (select 1 from public.leads where email = new.email or mobile = new.mobile);
  return new;
end $$;

create or replace function public.leads_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.id, 'created', 'Lead submitted from landing page' ||
          case when new.is_duplicate then ' (duplicate email/mobile)' else '' end);
  insert into public.events (type, visitor_id, page, referrer, utm_source, utm_medium, utm_campaign, device, browser)
  values ('lead', coalesce(nullif(new.visitor_id, ''), 'lead-' || new.id), left(new.page_url, 255), left(new.referrer, 255),
          new.utm_source, new.utm_medium, new.utm_campaign, new.device, public.browser_from_ua(new.user_agent));
  begin
    perform public.send_lead_to_n8n(new.id);
  exception when others then
    update public.leads set n8n_status = 'failed', n8n_response = left(sqlerrm, 500) where id = new.id;
  end;
  return null;
end $$;

create or replace function public.leads_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    perform public.log_activity(new.id, 'status', public.status_label(old.status) || ' → ' || public.status_label(new.status));
    v_url := public.setting('n8n_status_webhook_url');
    if v_url <> '' then
      begin
        perform net.http_post(url := v_url,
          body := jsonb_build_object('type', 'status_changed', 'old_status', old.status,
                                     'changed_by', coalesce(auth.jwt() ->> 'email', '')) || public.lead_payload(new),
          headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 8000);
      exception when others then null;
      end;
    end if;
  end if;
  if new.notes is distinct from old.notes then
    perform public.log_activity(new.id, 'note', 'Notes updated');
  end if;
  return new;
end $$;

create or replace function public.events_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ua text := public.req_header('user-agent');
begin
  if public.is_bot(v_ua) then return null; end if;
  -- flood guard: max 300 events per visitor per hour
  if (select count(*) from public.events where visitor_id = new.visitor_id and created_at > now() - interval '1 hour') > 300 then
    return null;
  end if;
  new.visitor_id := regexp_replace(new.visitor_id, '[^a-zA-Z0-9_-]', '', 'g');
  new.session_id := left(regexp_replace(new.session_id, '[^a-zA-Z0-9_-]', '', 'g'), 64);
  new.label := left(new.label, 120); new.page := left(new.page, 255); new.referrer := left(new.referrer, 255);
  new.utm_source := left(new.utm_source, 120); new.utm_medium := left(new.utm_medium, 120);
  new.utm_campaign := left(new.utm_campaign, 190);
  new.device := public.device_from_ua(v_ua);
  new.browser := public.browser_from_ua(v_ua);
  new.created_at := now();
  return new;
end $$;

drop trigger if exists leads_bi on public.leads;
create trigger leads_bi before insert on public.leads for each row execute function public.leads_before_insert();
drop trigger if exists leads_ai on public.leads;
create trigger leads_ai after insert on public.leads for each row execute function public.leads_after_insert();
drop trigger if exists leads_bu on public.leads;
create trigger leads_bu before update on public.leads for each row execute function public.leads_before_update();
-- the "lead" events are inserted by the leads trigger (no request headers needed), so only filter public inserts:
drop trigger if exists events_bi on public.events;
create trigger events_bi before insert on public.events for each row
  when (new.type <> 'lead') execute function public.events_before_insert();

-- ---------------------------------------------------------------------
-- Security: Row Level Security + grants
-- ---------------------------------------------------------------------
alter table public.settings      enable row level security;
alter table public.admins        enable row level security;
alter table public.leads         enable row level security;
alter table public.lead_activity enable row level security;
alter table public.events        enable row level security;

revoke all on public.settings, public.admins, public.leads, public.lead_activity, public.events from anon, authenticated;

-- Public (landing page): may only INSERT these columns. Never read.
grant insert (first_name, last_name, email, mobile, seats, super_balance, event_name, event_date, event_location,
              page_url, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid,
              visitor_id, event_id, user_timezone) on public.leads to anon, authenticated;
grant insert (type, visitor_id, session_id, label, page, referrer, utm_source, utm_medium, utm_campaign)
  on public.events to anon, authenticated;

-- Admins (logged-in AND listed in public.admins)
grant select, update, delete on public.leads to authenticated;
grant select, delete on public.events to authenticated;
grant select on public.lead_activity to authenticated;
grant select, insert, update on public.settings to authenticated;
grant select, insert, delete on public.admins to authenticated;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('settings','admins','leads','lead_activity','events') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy leads_public_insert  on public.leads  for insert to anon, authenticated with check (true);
create policy events_public_insert on public.events for insert to anon, authenticated with check (type <> 'lead');

create policy leads_admin_select on public.leads for select to authenticated using (public.is_admin());
create policy leads_admin_update on public.leads for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy leads_admin_delete on public.leads for delete to authenticated using (public.is_admin());
create policy events_admin_select on public.events for select to authenticated using (public.is_admin());
create policy events_admin_delete on public.events for delete to authenticated using (public.is_admin());
create policy activity_admin_select on public.lead_activity for select to authenticated using (public.is_admin());
create policy settings_admin_all on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admins_admin_select on public.admins for select to authenticated using (public.is_admin());
create policy admins_admin_insert on public.admins for insert to authenticated with check (public.is_admin());
create policy admins_admin_delete on public.admins for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- RPC functions
-- ---------------------------------------------------------------------

-- Public: the landing page reads the Pixel ID from here
create or replace function public.get_public_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pixel_id', regexp_replace(public.setting('meta_pixel_id'), '[^0-9]', '', 'g'))
$$;

create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
end $$;

-- Read pg_net responses and mark leads sent / failed
create or replace function public.refresh_n8n_status() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.assert_admin();
  update public.leads l set
    n8n_status = case when r.status_code between 200 and 299 then 'sent' else 'failed' end,
    n8n_code = r.status_code,
    n8n_response = left(coalesce(r.error_msg, r.content::text, ''), 500)
  from net._http_response r
  where r.id = l.n8n_request_id and l.n8n_status = 'queued';
  get diagnostics n = row_count;
  -- anything queued for > 6h without a stored response
  update public.leads set n8n_status = 'unknown' where n8n_status = 'queued' and n8n_sent_at < now() - interval '6 hours';
  return n;
end $$;

create or replace function public.resend_leads(p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare i bigint; n int := 0;
begin
  perform public.assert_admin();
  foreach i in array p_ids loop
    if public.send_lead_to_n8n(i) = 'queued' then
      perform public.log_activity(i, 'n8n', 'Re-sent to n8n'); n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.test_webhook(p_url text, p_which text default 'lead') returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_url !~* '^https?://' then raise exception 'Enter a valid URL first'; end if;
  return net.http_post(url := p_url, body := jsonb_build_object(
    'type', case when p_which = 'status' then 'status_changed' else 'new_lead' end, 'test', true, 'lead_id', 0,
    'first_name', 'Test', 'last_name', 'Lead', 'full_name', 'Test Lead', 'email', 'test@example.com',
    'mobile', '0400000000', 'mobile_intl', '+61400000000', 'seats', 1, 'super_balance', 'Prefer not to say',
    'status', 'new', 'source', 'admin test', 'submitted_at', now()),
    headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 8000);
end $$;

create or replace function public.webhook_result(p_request_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.assert_admin();
  select status_code, error_msg, left(content::text, 300) as content into r from net._http_response where id = p_request_id;
  if not found then return jsonb_build_object('done', false); end if;
  return jsonb_build_object('done', true, 'code', r.status_code, 'error', r.error_msg, 'body', r.content,
                            'ok', coalesce(r.status_code between 200 and 299, false));
end $$;

create or replace function public.reset_analytics() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  delete from public.events where true;
end $$;

-- KPI block for one period
create or replace function public._kpis(a timestamptz, b timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (select * from public.events where created_at >= a and created_at < b),
  k as (select
    (select count(*) from e where type = 'pageview') pageviews,
    (select count(distinct visitor_id) from e where type = 'pageview') visitors,
    (select count(distinct session_id) from e where type = 'pageview') sessions,
    (select count(*) from e where type = 'cta_click') cta_clicks,
    (select count(distinct visitor_id) from e where type = 'cta_click') cta_clickers,
    (select count(distinct visitor_id) from e where type = 'form_start') form_starts,
    (select count(distinct visitor_id) from e where type = 'engaged_30s') engaged,
    (select count(*) from public.leads where created_at >= a and created_at < b) leads,
    (select coalesce(sum(seats), 0) from public.leads where created_at >= a and created_at < b) seats)
  select to_jsonb(k) || jsonb_build_object(
    'conversion', case when visitors > 0 then round(leads * 100.0 / visitors, 1) else 0 end,
    'cta_rate',   case when visitors > 0 then round(cta_clickers * 100.0 / visitors, 1) else 0 end)
  from k
$$;

-- Everything the dashboard needs, in one call. Dates are local (report timezone).
create or replace function public.dashboard_stats(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := coalesce(nullif(public.setting('timezone'), ''), 'UTC');
  a timestamptz; b timestamptz; pa timestamptz; pb timestamptz;
  days int; res jsonb;
begin
  perform public.assert_admin();
  if p_from > p_to then select p_to, p_from into p_from, p_to; end if;
  a := p_from::timestamp at time zone tz;
  b := (p_to + 1)::timestamp at time zone tz;
  days := p_to - p_from + 1;
  pa := (p_from - days)::timestamp at time zone tz;
  pb := a;

  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'prev', jsonb_build_object('from', p_from - days, 'to', p_from - 1),
    'kpi', public._kpis(a, b),
    'kpi_prev', public._kpis(pa, pb),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('d', d::date, 'visitors', coalesce(ev.v, 0), 'pageviews', coalesce(ev.pv, 0),
                                                  'cta_clicks', coalesce(ev.c, 0), 'leads', coalesce(ld.n, 0)) order by d), '[]')
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
      left join (select (created_at at time zone tz)::date dd, count(distinct visitor_id) filter (where type = 'pageview') v,
                        count(*) filter (where type = 'pageview') pv, count(*) filter (where type = 'cta_click') c
                 from public.events where created_at >= a and created_at < b group by 1) ev on ev.dd = d::date
      left join (select (created_at at time zone tz)::date dd, count(*) n
                 from public.leads where created_at >= a and created_at < b group by 1) ld on ld.dd = d::date),
    'status', (
      select coalesce(jsonb_agg(jsonb_build_object('key', status, 'n', n) order by n desc), '[]')
      from (select status, count(*) n from public.leads where created_at >= a and created_at < b group by status) s),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'visitors', visitors, 'leads', leads)
                                order by visitors + leads * 10 desc), '[]')
      from (select coalesce(v.label, l.label) label, coalesce(v.n, 0) visitors, coalesce(l.n, 0) leads
            from (select public.source_label(utm_source, referrer, '', '') label, count(distinct visitor_id) n
                  from public.events where type = 'pageview' and created_at >= a and created_at < b group by 1) v
            full join (select public.source_label(utm_source, referrer, fbclid, gclid) label, count(*) n
                  from public.leads where created_at >= a and created_at < b group by 1) l on l.label = v.label
            order by coalesce(v.n, 0) + coalesce(l.n, 0) * 10 desc limit 8) s),
    'campaigns', (
      select coalesce(jsonb_agg(jsonb_build_object('c', c, 'n', n, 's', s) order by n desc), '[]')
      from (select coalesce(nullif(utm_campaign, ''), '(none)') c, count(*) n, sum(seats) s
            from public.leads where created_at >= a and created_at < b group by 1 order by 2 desc limit 10) x),
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object('device', device, 'n', n) order by n desc), '[]')
      from (select coalesce(nullif(device, ''), 'Unknown') device, count(distinct visitor_id) n
            from public.events where type = 'pageview' and created_at >= a and created_at < b group by 1) x),
    'ctas', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'n', n) order by n desc), '[]')
      from (select coalesce(nullif(label, ''), '(unlabelled)') label, count(*) n
            from public.events where type = 'cta_click' and created_at >= a and created_at < b group by 1 order by 2 desc limit 10) x),
    'hours', (
      select jsonb_agg(coalesce(n, 0) order by h)
      from generate_series(0, 23) h
      left join (select extract(hour from created_at at time zone tz)::int hh, count(*) n
                 from public.leads where created_at >= a and created_at < b group by 1) x on x.hh = h),
    'super', (
      select coalesce(jsonb_agg(jsonb_build_object('b', bal, 'n', n) order by n desc), '[]')
      from (select coalesce(nullif(super_balance, ''), 'Not given') bal, count(*) n
            from public.leads where created_at >= a and created_at < b group by 1) x),
    'funnel', (select jsonb_build_array(
        jsonb_build_array('Visitors', k ->> 'visitors'), jsonb_build_array('Engaged 30s+', k ->> 'engaged'),
        jsonb_build_array('Clicked CTA', k ->> 'cta_clickers'), jsonb_build_array('Started form', k ->> 'form_starts'),
        jsonb_build_array('Submitted lead', k ->> 'leads')) from (select public._kpis(a, b) k) z),
    'recent', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc), '[]')
      from (select id, first_name, last_name, seats, status, created_at,
                   public.source_label(utm_source, referrer, fbclid, gclid) source
            from public.leads order by id desc limit 6) x),
    'live', (select count(distinct visitor_id) from public.events where created_at > now() - interval '5 minutes'),
    'capacity', jsonb_build_object(
        'booked', (select coalesce(sum(seats), 0) from public.leads where status not in ('not_interested', 'no_show')),
        'total', coalesce(nullif(public.setting('event_capacity'), '')::int, 0)),
    'timezone', tz
  ) into res;
  return res;
end $$;

-- Lock down function execution: only what the landing page needs is public
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_public_config() to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.refresh_n8n_status(), public.resend_leads(bigint[]), public.test_webhook(text, text),
  public.webhook_result(bigint), public.reset_analytics(), public.dashboard_stats(date, date) to authenticated;
-- helpers used inside RLS / triggers / column defaults
grant execute on function public.setting(text), public.req_header(text), public.client_ip(), public.device_from_ua(text),
  public.browser_from_ua(text), public.is_bot(text), public.source_label(text, text, text, text), public.status_label(text)
  to anon, authenticated;

-- =====================================================================
-- LAST STEP — make yourself an admin (change the email, then run this line):
--   insert into public.admins (email) values ('you@yourcompany.com');
-- =====================================================================
