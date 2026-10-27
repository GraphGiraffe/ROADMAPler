-- Apply once in the owner's Supabase SQL editor. No service_role key in the client.
begin;
create table if not exists public.roadmap_projects (
 owner uuid not null references auth.users(id) on delete cascade,
 id uuid not null,
 revision bigint not null check (revision > 0),
 data jsonb,
 deleted boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key (owner,id),
 check (deleted or (data is not null and jsonb_typeof(data) = 'object'))
);
create table if not exists public.roadmap_versions (
 owner uuid not null references auth.users(id) on delete cascade,
 id uuid not null,
 revision bigint not null,
 data jsonb,
 deleted boolean not null,
 updated_at timestamptz not null default now(),
 primary key (owner,id,revision),
 foreign key (owner,id) references public.roadmap_projects(owner,id) on delete cascade
);
alter table public.roadmap_projects enable row level security;
alter table public.roadmap_versions enable row level security;
drop policy if exists roadmap_owner_read on public.roadmap_projects;
create policy roadmap_owner_read on public.roadmap_projects for select to authenticated using ((select auth.uid()) = owner);
drop policy if exists roadmap_version_owner_read on public.roadmap_versions;
create policy roadmap_version_owner_read on public.roadmap_versions for select to authenticated using ((select auth.uid()) = owner);
revoke all on public.roadmap_projects, public.roadmap_versions from anon, authenticated;
grant select on public.roadmap_projects, public.roadmap_versions to authenticated;
create schema if not exists roadmap_private;
revoke all on schema roadmap_private from public,anon,authenticated;
create or replace function roadmap_private.validate_project(value jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare field text; item jsonb; start_index bigint; end_index bigint; status text;
begin
 if value is null or value->>'format' is distinct from 'roadmap-project' or jsonb_typeof(value->'formatVersion') is distinct from 'number' or value->'formatVersion' not in ('1'::jsonb,'2'::jsonb) or jsonb_typeof(value->'project'->'name') is distinct from 'string' then raise sqlstate 'PT400' using message='Неподдерживаемый проект.'; end if;
 foreach field in array array['tracks','releases','tasks','sources'] loop
  if jsonb_typeof(value->field) is distinct from 'array' then raise sqlstate 'PT400' using message='Некорректный список проекта.'; end if;
 end loop;
 if jsonb_array_length(value->'tracks')=0 then raise sqlstate 'PT400' using message='Проект должен содержать трек.'; end if;
 foreach field in array array['tracks','releases','tasks'] loop
  if (select count(*) from jsonb_array_elements(value->field))<>(select count(distinct x->>'id') from jsonb_array_elements(value->field) x) then raise sqlstate 'PT400' using message='Идентификаторы должны быть уникальны.'; end if;
  for item in select * from jsonb_array_elements(value->field) loop
   if jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'title') is distinct from 'string' then raise sqlstate 'PT400' using message='Некорректная сущность проекта.'; end if;
   if field='releases' and item->>'id' in ('backlog','add-release') then raise sqlstate 'PT400' using message='Зарезервированный идентификатор релиза.'; end if;
  end loop;
 end loop;
 for item in select x from jsonb_array_elements(value->'releases') x union all select jsonb_build_object('defaultStatus',value->'backlogDefaultStatus') where value ? 'backlogDefaultStatus' loop
  if item ? 'defaultStatus' and item->>'defaultStatus' is distinct from '' then
   if value->'formatVersion'='1'::jsonb or jsonb_typeof(item->'defaultStatus') is distinct from 'string' or item->>'defaultStatus' not in ('done','idea','check','planned','work','blocked','paused') then raise sqlstate 'PT400' using message='Некорректный статус колонки.'; end if;
  end if;
 end loop;
 for item in select * from jsonb_array_elements(value->'tasks') loop
  if jsonb_typeof(item->'description') is distinct from 'string' or jsonb_typeof(item->'status') is distinct from 'string' or item->>'status' not in ('done','idea','check','planned','work','blocked','paused') or not exists(select 1 from jsonb_array_elements(value->'tracks') x where x->'id'=item->'track') or (item->>'release' is distinct from 'backlog' and not exists(select 1 from jsonb_array_elements(value->'releases') x where x->'id'=item->'release')) then raise sqlstate 'PT400' using message='Некорректная карточка проекта.'; end if;
  if item ? 'releaseEnd' then
   select r.ordinality into start_index from jsonb_array_elements(value->'releases') with ordinality r where r.value->'id'=item->'release';
   select r.ordinality into end_index from jsonb_array_elements(value->'releases') with ordinality r where r.value->'id'=item->'releaseEnd';
   if value->'formatVersion'='1'::jsonb or start_index is null or end_index is null or end_index<start_index then raise sqlstate 'PT400' using message='Некорректный диапазон релизов.'; end if;
  end if;
 end loop;
end $$;
revoke all on function roadmap_private.validate_project(jsonb) from public,anon,authenticated;
create or replace function roadmap_private.write_project(p_owner uuid,p_id uuid,p_expected bigint,p_data jsonb,p_deleted boolean default false)
returns setof public.roadmap_projects language plpgsql security invoker set search_path = '' as $$
declare
 uid uuid := p_owner;
 current_row public.roadmap_projects;
 new_revision bigint;
begin
 if uid is null then raise sqlstate 'PT401' using message = 'Нужен вход в аккаунт.'; end if;
 if p_expected is null or p_expected < 0 or p_deleted is null then raise sqlstate 'PT400' using message = 'Некорректная версия.'; end if;
 if pg_catalog.octet_length(p_data::text) > 1048576 then raise sqlstate 'PT413' using message = 'Проект превышает 1 МБ.'; end if;
 if not p_deleted then perform roadmap_private.validate_project(p_data); end if;
 -- Serialize all writes of one account, including initial inserts and quota checks.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
 select * into current_row from public.roadmap_projects where owner=uid and id=p_id for update;
 if coalesce(current_row.revision,0) <> p_expected then raise sqlstate 'PT409' using message = 'Проект изменён на другом устройстве.'; end if;
 if current_row.id is null and (select count(*) from public.roadmap_projects where owner=uid) >= 50 then raise sqlstate 'PT413' using message = 'Лимит — 50 облачных проектов на аккаунт.'; end if;
 if (select coalesce(sum(pg_catalog.pg_column_size(data)),0) from public.roadmap_versions where owner=uid and not (id=p_id and revision <= p_expected+1-20)) + coalesce(pg_catalog.pg_column_size(p_data),0) > 10485760 then raise sqlstate 'PT413' using message = 'История аккаунта превышает 10 МБ. Экспортируйте данные и обратитесь к владельцу сервера.'; end if;
 new_revision := p_expected+1;
 insert into public.roadmap_projects(owner,id,revision,data,deleted) values(uid,p_id,new_revision,case when p_deleted then null else p_data end,p_deleted)
 on conflict(owner,id) do update set revision=excluded.revision,data=excluded.data,deleted=excluded.deleted,updated_at=now();
 insert into public.roadmap_versions(owner,id,revision,data,deleted) values(uid,p_id,new_revision,case when p_deleted then null else p_data end,p_deleted);
 delete from public.roadmap_versions where owner=uid and id=p_id and revision <= new_revision-20;
 return query select * from public.roadmap_projects where owner=uid and id=p_id;
end $$;
revoke all on function roadmap_private.write_project(uuid,uuid,bigint,jsonb,boolean) from public,anon,authenticated;
create or replace function public.roadmap_write(p_id uuid,p_expected bigint,p_data jsonb,p_deleted boolean default false)
returns setof public.roadmap_projects language plpgsql security definer set search_path = '' as $$
begin
 return query select * from roadmap_private.write_project(auth.uid(),p_id,p_expected,p_data,p_deleted);
end $$;
revoke all on function public.roadmap_write(uuid,bigint,jsonb,boolean) from public, anon;
grant execute on function public.roadmap_write(uuid,bigint,jsonb,boolean) to authenticated;
commit;
