-- First apply the current server/supabase.sql, then this migration in SQL Editor.
-- No Edge Function or administrative key is needed by integrations.
begin;
create table if not exists roadmap_private.integration_tokens (
 id uuid primary key default gen_random_uuid(),
 owner uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null,
 name text not null check (length(name) between 1 and 100),
 token_hash bytea not null unique check (octet_length(token_hash)=32),
 prefix text not null,
 can_read boolean not null,
 can_write boolean not null,
 can_delete boolean not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 last_used_at timestamptz,
 foreign key (owner,project_id) references public.roadmap_projects(owner,id) on delete cascade,
 check (can_read or can_write or can_delete)
);
alter table roadmap_private.integration_tokens enable row level security;
revoke all on roadmap_private.integration_tokens from public,anon,authenticated;
create index if not exists integration_tokens_owner_project on roadmap_private.integration_tokens(owner,project_id);

create or replace function public.roadmap_integration_create(p_project_id uuid,p_name text,p_expires_at timestamptz,p_read boolean default true,p_write boolean default false,p_delete boolean default false)
returns table(id uuid,name text,project_id uuid,prefix text,can_read boolean,can_write boolean,can_delete boolean,created_at timestamptz,expires_at timestamptz,revoked_at timestamptz,last_used_at timestamptz,secret_token text)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); secret text; token_id uuid := gen_random_uuid();
begin
 if uid is null then raise sqlstate 'PT401' using message='Нужен вход в аккаунт.'; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 100 or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '366 days' or p_read is null or p_write is null or p_delete is null or not (p_read or p_write or p_delete) then
  raise sqlstate 'PT400' using message='Укажите название, права и срок действия до одного года.';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
 if not exists(select 1 from public.roadmap_projects p where p.owner=uid and p.id=p_project_id and not p.deleted) then raise sqlstate 'PT404' using message='Облачный проект не найден.'; end if;
 if (select count(*) from roadmap_private.integration_tokens t where t.owner=uid and t.revoked_at is null and t.expires_at>now())>=100 then raise sqlstate 'PT413' using message='Лимит — 100 действующих токенов.'; end if;
 if (select count(*) from roadmap_private.integration_tokens t where t.owner=uid)>=1000 then raise sqlstate 'PT413' using message='Лимит истории — 1000 токенов. Обратитесь к владельцу сервера.'; end if;
 -- Two cryptographic UUIDs provide 244 random bits; only a SHA-256 hash is retained.
 secret:='rmi_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into roadmap_private.integration_tokens(id,owner,project_id,name,token_hash,prefix,can_read,can_write,can_delete,expires_at)
 values(token_id,uid,p_project_id,btrim(p_name),pg_catalog.sha256(pg_catalog.convert_to(secret,'UTF8')),left(secret,12),p_read,p_write,p_delete,p_expires_at);
 return query select t.id,t.name,t.project_id,t.prefix,t.can_read,t.can_write,t.can_delete,t.created_at,t.expires_at,t.revoked_at,t.last_used_at,secret from roadmap_private.integration_tokens t where t.id=token_id;
end $$;

create or replace function public.roadmap_integration_list(p_project_id uuid default null)
returns table(id uuid,name text,project_id uuid,prefix text,can_read boolean,can_write boolean,can_delete boolean,created_at timestamptz,expires_at timestamptz,revoked_at timestamptz,last_used_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise sqlstate 'PT401' using message='Нужен вход в аккаунт.'; end if;
 return query select t.id,t.name,t.project_id,t.prefix,t.can_read,t.can_write,t.can_delete,t.created_at,t.expires_at,t.revoked_at,t.last_used_at
 from roadmap_private.integration_tokens t where t.owner=auth.uid() and (p_project_id is null or t.project_id=p_project_id) order by t.created_at desc,t.id;
end $$;

create or replace function public.roadmap_integration_revoke(p_token_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise sqlstate 'PT401' using message='Нужен вход в аккаунт.'; end if;
 update roadmap_private.integration_tokens t set revoked_at=coalesce(t.revoked_at,now()) where t.id=p_token_id and t.owner=auth.uid();
 return found;
end $$;

-- The capability is a header, never a URL parameter or a project field.
create or replace function public.roadmap_integration_access(p_project_id uuid,p_action text default 'read',p_expected bigint default null,p_data jsonb default null)
returns table(id uuid,revision bigint,data jsonb,deleted boolean,updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
 secret text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-roadmapler-token','');
 token_row roadmap_private.integration_tokens;
 current_row public.roadmap_projects;
begin
 if secret !~ '^rmi_[0-9a-f]{64}$' then raise sqlstate 'PT401' using message='Недействительный токен интеграции.'; end if;
 select * into token_row from roadmap_private.integration_tokens t where t.token_hash=pg_catalog.sha256(pg_catalog.convert_to(secret,'UTF8')) for update;
 if token_row.id is null or token_row.revoked_at is not null or token_row.expires_at<=clock_timestamp() then raise sqlstate 'PT401' using message='Недействительный токен интеграции.'; end if;
 if p_project_id is null or token_row.project_id<>p_project_id then raise sqlstate 'PT403' using message='Токен не даёт доступ к этому проекту.'; end if;
 if p_action is null or p_action not in ('read','write','delete') then raise sqlstate 'PT400' using message='Неизвестное действие.'; end if;
 if (p_action='read' and not token_row.can_read) or (p_action='write' and not token_row.can_write) or (p_action='delete' and not token_row.can_delete) then raise sqlstate 'PT403' using message='У токена нет нужного разрешения.'; end if;
 select * into current_row from public.roadmap_projects p where p.owner=token_row.owner and p.id=p_project_id;
 if current_row.id is null then raise sqlstate 'PT404' using message='Проект не найден.'; end if;
 if p_action='read' then
  return query select current_row.id,current_row.revision,current_row.data,current_row.deleted,current_row.updated_at;
 else
  if current_row.deleted and p_action='write' then raise sqlstate 'PT410' using message='Проект удалён. Восстановление доступно владельцу в приложении.'; end if;
  return query select p.id,p.revision,p.data,p.deleted,p.updated_at from roadmap_private.write_project(token_row.owner,p_project_id,p_expected,p_data,p_action='delete') p;
 end if;
 update roadmap_private.integration_tokens t set last_used_at=clock_timestamp() where t.id=token_row.id;
end $$;

revoke all on function public.roadmap_integration_create(uuid,text,timestamptz,boolean,boolean,boolean) from public,anon;
revoke all on function public.roadmap_integration_list(uuid) from public,anon;
revoke all on function public.roadmap_integration_revoke(uuid) from public,anon;
revoke all on function public.roadmap_integration_access(uuid,text,bigint,jsonb) from public;
grant execute on function public.roadmap_integration_create(uuid,text,timestamptz,boolean,boolean,boolean) to authenticated;
grant execute on function public.roadmap_integration_list(uuid) to authenticated;
grant execute on function public.roadmap_integration_revoke(uuid) to authenticated;
grant execute on function public.roadmap_integration_access(uuid,text,bigint,jsonb) to anon,authenticated;
commit;
