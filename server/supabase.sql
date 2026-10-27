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
create or replace function public.roadmap_write(p_id uuid,p_expected bigint,p_data jsonb,p_deleted boolean default false)
returns setof public.roadmap_projects language plpgsql security definer set search_path = '' as $$
declare
 uid uuid := auth.uid();
 current_row public.roadmap_projects;
 new_revision bigint;
begin
 if uid is null then raise sqlstate 'PT401' using message = 'Нужен вход в аккаунт.'; end if;
 if p_expected is null or p_expected < 0 or p_deleted is null then raise sqlstate 'PT400' using message = 'Некорректная версия.'; end if;
 if not p_deleted and (p_data is null or jsonb_typeof(p_data) <> 'object' or p_data->>'format' is distinct from 'roadmap-project' or coalesce(p_data->>'formatVersion','') not in ('1','2') or jsonb_typeof(p_data->'project') is distinct from 'object') then
  raise sqlstate 'PT400' using message = 'Неподдерживаемый проект.';
 end if;
 if pg_catalog.octet_length(p_data::text) > 1048576 then raise sqlstate 'PT413' using message = 'Проект превышает 1 МБ.'; end if;
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
revoke all on function public.roadmap_write(uuid,bigint,jsonb,boolean) from public, anon;
grant execute on function public.roadmap_write(uuid,bigint,jsonb,boolean) to authenticated;
commit;
