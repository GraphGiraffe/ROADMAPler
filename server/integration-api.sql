-- Apply after server/supabase.sql and server/integrations.sql. Additive and repeatable.
begin;
-- Locked capability check shared by the compact card and delta endpoints.
create or replace function roadmap_private.integration_authorize(p_project_id uuid,p_permission text)
returns roadmap_private.integration_tokens language plpgsql security invoker set search_path = '' as $$
declare secret text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-roadmapler-token',''); capability roadmap_private.integration_tokens;
begin
 if secret !~ '^rmi_[0-9a-f]{64}$' then raise sqlstate 'PT401' using message='Недействительный токен интеграции.'; end if;
 select * into capability from roadmap_private.integration_tokens t where t.token_hash=pg_catalog.sha256(pg_catalog.convert_to(secret,'UTF8')) for update;
 if capability.id is null or capability.revoked_at is not null or capability.expires_at<=clock_timestamp() then raise sqlstate 'PT401' using message='Недействительный токен интеграции.'; end if;
 if p_project_id is null or capability.project_id<>p_project_id then raise sqlstate 'PT403' using message='Токен не даёт доступ к этому проекту.'; end if;
 if p_permission is null or p_permission not in ('read','write') or (p_permission='read' and not capability.can_read) or (p_permission='write' and not capability.can_write) then raise sqlstate 'PT403' using message='У токена нет нужного разрешения.'; end if;
 return capability;
end $$;
revoke all on function roadmap_private.integration_authorize(uuid,text) from public,anon,authenticated;

create or replace function public.roadmap_integration_cards(
 p_project_id uuid,p_action text default 'search',p_task_id text default null,p_expected bigint default null,p_patch jsonb default null,
 p_query text default null,p_track text default null,p_release text default null,p_status text default null,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare capability roadmap_private.integration_tokens; current_row public.roadmap_projects; task jsonb; position_index integer; field text; entry jsonb; next_data jsonb; result jsonb; total integer; matches jsonb; is_write boolean;
begin
 is_write:=p_action in ('create','update','comment','delete');
 capability:=roadmap_private.integration_authorize(p_project_id,case when is_write then 'write' else 'read' end);
 if p_action is null or p_action not in ('search','get','create','update','comment','delete') then raise sqlstate 'PT400' using message='Неизвестное действие карточки.'; end if;
 select * into current_row from public.roadmap_projects p where p.owner=capability.owner and p.id=p_project_id;
 if current_row.id is null then raise sqlstate 'PT404' using message='Проект не найден.'; end if;
 if current_row.deleted then raise sqlstate 'PT410' using message='Проект удалён.'; end if;
 if p_action='search' then
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 or length(p_query)>1000 then raise sqlstate 'PT400' using message='Лимит 1–100, смещение 0–100000, запрос до 1000 символов.'; end if;
  if p_status is not null and p_status not in ('done','idea','check','planned','work','blocked','paused') then raise sqlstate 'PT400' using message='Неизвестный статус.'; end if;
  if p_track is not null and not exists(select 1 from jsonb_array_elements(current_row.data->'tracks') t where t->>'id'=p_track) then raise sqlstate 'PT400' using message='Неизвестный трек.'; end if;
  if p_release is not null and p_release<>'backlog' and not exists(select 1 from jsonb_array_elements(current_row.data->'releases') r where r->>'id'=p_release) then raise sqlstate 'PT400' using message='Неизвестный релиз.'; end if;
  select coalesce(jsonb_agg(t.value order by t.ordinality),'[]'::jsonb) into matches
  from jsonb_array_elements(current_row.data->'tasks') with ordinality t
  where (p_track is null or t.value->>'track'=p_track) and (p_status is null or t.value->>'status'=p_status)
   and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',t.value->>'id',t.value->>'title',t.value->>'description',t.value->>'comment',t.value->>'accept')))>0)
   and (p_release is null or t.value->>'release'=p_release or (p_release<>'backlog' and t.value ? 'releaseEnd' and exists(
    select 1 from jsonb_array_elements(current_row.data->'releases') with ordinality r,
     jsonb_array_elements(current_row.data->'releases') with ordinality s,jsonb_array_elements(current_row.data->'releases') with ordinality e
    where r.value->>'id'=p_release and s.value->>'id'=t.value->>'release' and e.value->>'id'=t.value->>'releaseEnd' and r.ordinality between s.ordinality and e.ordinality)));
  total:=jsonb_array_length(matches);
  select coalesce(jsonb_agg(x.value order by x.ordinality),'[]'::jsonb) into matches from jsonb_array_elements(matches) with ordinality x where x.ordinality>p_offset and x.ordinality<=p_offset+p_limit;
  result:=jsonb_build_object('tasks',matches,'total',total,'limit',p_limit,'offset',p_offset);
 else
  if p_task_id is null or length(p_task_id) not between 1 and 200 then raise sqlstate 'PT400' using message='Нужен ID карточки до 200 символов.'; end if;
  select t.value,(t.ordinality-1)::integer into task,position_index from jsonb_array_elements(current_row.data->'tasks') with ordinality t where t.value->>'id'=p_task_id;
  if is_write then
   if p_expected is null or p_expected<1 then raise sqlstate 'PT400' using message='Нужна положительная ожидаемая ревизия.'; end if;
   if p_expected<>current_row.revision then raise sqlstate 'PT409' using message='Проект изменён на другом устройстве.'; end if;
  end if;
  if p_action='create' then
   if task is not null then raise sqlstate 'PT409' using message='Карточка с таким ID уже существует.'; end if;
   task:=jsonb_build_object('id',p_task_id);
  elsif task is null then raise sqlstate 'PT404' using message='Карточка не найдена.';
  end if;
  if p_action in ('create','update') then
   if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb or octet_length(p_patch::text)>65536 then raise sqlstate 'PT400' using message='Нужен непустой объект изменений до 64 КиБ.'; end if;
   for field,entry in select * from jsonb_each(p_patch) loop
    if field not in ('title','description','accept','comment','track','release','releaseEnd','status') or (jsonb_typeof(entry) is distinct from 'string' and not (field='releaseEnd' and entry='null'::jsonb)) then raise sqlstate 'PT400' using message='Неизвестное поле или неверный тип изменения карточки.'; end if;
    if (field='title' and length(btrim(entry#>>'{}')) not between 1 and 180) or (field='description' and length(entry#>>'{}')>12000) or (field='accept' and length(entry#>>'{}')>6000) or (field='comment' and length(entry#>>'{}')>1000) then raise sqlstate 'PT400' using message='Превышена длина поля карточки или пустое название.'; end if;
   end loop;
   task:=task||p_patch;
   if task->'releaseEnd'='null'::jsonb then task:=task-'releaseEnd'; end if;
  elsif p_action='comment' then
   if jsonb_typeof(p_patch) is distinct from 'object' or not (p_patch ? 'text') or p_patch-'text'<>'{}'::jsonb or jsonb_typeof(p_patch->'text') is distinct from 'string' or length(btrim(p_patch->>'text'))=0 then raise sqlstate 'PT400' using message='Нужен непустой текст комментария.'; end if;
   entry:=to_jsonb(concat_ws(E'\n\n',nullif(task->>'comment',''),btrim(p_patch->>'text')));
   if length(entry#>>'{}')>1000 then raise sqlstate 'PT400' using message='Комментарий после добавления превышает 1000 символов.'; end if;
   task:=jsonb_set(task,'{comment}',entry);
  end if;
  if is_write then
   next_data:=current_row.data;
   if p_action='create' then next_data:=jsonb_set(next_data,'{tasks}',(next_data->'tasks')||jsonb_build_array(task));
   elsif p_action='delete' then next_data:=next_data#-array['tasks',position_index::text];
   else next_data:=jsonb_set(next_data,array['tasks',position_index::text],task); end if;
   if task ? 'releaseEnd' then next_data:=jsonb_set(next_data,'{formatVersion}','2'::jsonb); end if;
   -- The shared writer checks the same revision again under the account write lock.
   select * into current_row from roadmap_private.write_project(capability.owner,p_project_id,p_expected,next_data,false);
  end if;
  result:=case when p_action='delete' then jsonb_build_object('removed_task_id',p_task_id) else jsonb_build_object('task',task) end;
 end if;
 update roadmap_private.integration_tokens set last_used_at=clock_timestamp() where id=capability.id;
 return jsonb_build_object('id',current_row.id,'revision',current_row.revision,'deleted',false,'updated_at',current_row.updated_at)||result;
end $$;
revoke all on function public.roadmap_integration_cards(uuid,text,text,bigint,jsonb,text,text,text,text,integer,integer) from public;
grant execute on function public.roadmap_integration_cards(uuid,text,text,bigint,jsonb,text,text,text,text,integer,integer) to anon,authenticated;

create or replace function roadmap_private.integration_entity_delta(before_items jsonb,after_items jsonb)
returns jsonb language sql immutable security invoker set search_path = '' as $$
 select jsonb_build_object(
 'upsert',coalesce((select jsonb_agg(n.value order by n.ordinality) from jsonb_array_elements(after_items) with ordinality n where not exists(select 1 from jsonb_array_elements(before_items) b where b->>'id'=n.value->>'id' and b=n.value)),'[]'::jsonb),
 'removed',coalesce((select jsonb_agg(b->'id') from jsonb_array_elements(before_items) b where not exists(select 1 from jsonb_array_elements(after_items) n where n->>'id'=b->>'id')),'[]'::jsonb),
 'order',coalesce((select jsonb_agg(n.value->'id' order by n.ordinality) from jsonb_array_elements(after_items) with ordinality n),'[]'::jsonb))
$$;
revoke all on function roadmap_private.integration_entity_delta(jsonb,jsonb) from public,anon,authenticated;

create or replace function public.roadmap_integration_changes(p_project_id uuid,p_since bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare capability roadmap_private.integration_tokens; current_row public.roadmap_projects; baseline public.roadmap_versions; changes jsonb:='{}'::jsonb; field text; fields jsonb; removed jsonb; reset_required boolean:=false;
begin
 capability:=roadmap_private.integration_authorize(p_project_id,'read');
 select * into current_row from public.roadmap_projects p where p.owner=capability.owner and p.id=p_project_id;
 if current_row.id is null then raise sqlstate 'PT404' using message='Проект не найден.'; end if;
 if p_since is null or p_since<0 or p_since>current_row.revision then raise sqlstate 'PT400' using message='Ревизия должна быть между нулём и текущей версией.'; end if;
 if not current_row.deleted and p_since<>current_row.revision then
  select * into baseline from public.roadmap_versions v where v.owner=capability.owner and v.id=p_project_id and v.revision=p_since;
  reset_required:=baseline.id is null or baseline.deleted or baseline.data is null;
  if not reset_required then
   select coalesce(jsonb_object_agg(n.key,n.value),'{}'::jsonb) into fields from jsonb_each(current_row.data) n where n.key not in ('tracks','releases','tasks') and (not (baseline.data ? n.key) or baseline.data->n.key is distinct from n.value);
   select coalesce(jsonb_agg(b.key),'[]'::jsonb) into removed from jsonb_each(baseline.data) b where b.key not in ('tracks','releases','tasks') and not (current_row.data ? b.key);
   changes:=jsonb_build_object('fields',fields,'removed_fields',removed);
   foreach field in array array['tracks','releases','tasks'] loop
    if baseline.data->field is distinct from current_row.data->field then changes:=changes||jsonb_build_object(field,roadmap_private.integration_entity_delta(baseline.data->field,current_row.data->field)); end if;
   end loop;
  end if;
 end if;
 update roadmap_private.integration_tokens set last_used_at=clock_timestamp() where id=capability.id;
 return jsonb_build_object('id',current_row.id,'from_revision',p_since,'revision',current_row.revision,'deleted',current_row.deleted,'updated_at',current_row.updated_at,'reset_required',reset_required,'changes',case when reset_required or current_row.deleted then null else changes end);
end $$;
revoke all on function public.roadmap_integration_changes(uuid,bigint) from public;
grant execute on function public.roadmap_integration_changes(uuid,bigint) to anon,authenticated;

-- Compact CRUD for tracks and releases; deleting populated entities requires a strategy.
create or replace function public.roadmap_integration_structure(
 p_project_id uuid,p_kind text,p_action text default 'search',p_entity_id text default null,p_expected bigint default null,p_patch jsonb default null,
 p_position integer default null,p_cards text default null,p_target_track text default null,p_target_release text default null,p_query text default null,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare capability roadmap_private.integration_tokens; current_row public.roadmap_projects; entity jsonb; items jsonb; next_data jsonb; task jsonb; tasks jsonb:='[]'::jsonb; field text; entry jsonb; index_value integer; entity_index integer; start_index integer; end_index integer; affected integer:=0; is_write boolean; result jsonb; total integer;
begin
 is_write:=p_action in ('create','update','delete');capability:=roadmap_private.integration_authorize(p_project_id,case when is_write then 'write' else 'read' end);
 if p_kind is null or p_kind not in ('tracks','releases') or p_action is null or p_action not in ('search','get','create','update','delete') then raise sqlstate 'PT400' using message='Неизвестная сущность или действие.'; end if;
 select * into current_row from public.roadmap_projects p where p.owner=capability.owner and p.id=p_project_id;
 if current_row.id is null then raise sqlstate 'PT404' using message='Проект не найден.'; end if;
 if current_row.deleted then raise sqlstate 'PT410' using message='Проект удалён.'; end if;
 items:=current_row.data->p_kind;
 if p_action='search' then
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 or length(p_query)>1000 then raise sqlstate 'PT400' using message='Некорректная пагинация или запрос.'; end if;
  select coalesce(jsonb_agg(t.value order by t.ordinality),'[]'::jsonb) into items from jsonb_array_elements(items) with ordinality t where p_query is null or position(lower(p_query) in lower(concat_ws(' ',t.value->>'id',t.value->>'title',t.value->>'subtitle',t.value->>'note')))>0;
  total:=jsonb_array_length(items);
  select coalesce(jsonb_agg(t.value order by t.ordinality),'[]'::jsonb) into items from jsonb_array_elements(items) with ordinality t where t.ordinality>p_offset and t.ordinality<=p_offset+p_limit;
  result:=jsonb_build_object(p_kind,items,'total',total,'limit',p_limit,'offset',p_offset);
 else
  if p_entity_id is null or length(p_entity_id) not between 1 and 200 or (p_kind='releases' and p_entity_id in ('backlog','add-release')) then raise sqlstate 'PT400' using message='Некорректный ID трека или релиза.'; end if;
  select t.value,(t.ordinality-1)::integer into entity,entity_index from jsonb_array_elements(items) with ordinality t where t.value->>'id'=p_entity_id;
  if is_write then
   if p_expected is null or p_expected<1 then raise sqlstate 'PT400' using message='Нужна положительная ожидаемая ревизия.'; end if;
   if p_expected<>current_row.revision then raise sqlstate 'PT409' using message='Проект изменён на другом устройстве.'; end if;
  end if;
  if p_action='create' then
   if entity is not null then raise sqlstate 'PT409' using message='Такой ID уже существует.'; end if;
   entity:=jsonb_build_object('id',p_entity_id);
  elsif entity is null then raise sqlstate 'PT404' using message='Трек или релиз не найден.'; end if;
  next_data:=current_row.data;
  if p_action in ('create','update') then
   if p_patch is not null and jsonb_typeof(p_patch) is distinct from 'object' then raise sqlstate 'PT400' using message='Нужен объект полей.'; end if;
   if coalesce(p_patch,'{}'::jsonb)='{}'::jsonb and p_position is null then raise sqlstate 'PT400' using message='Не заданы поля или позиция.'; end if;
   for field,entry in select * from jsonb_each(coalesce(p_patch,'{}'::jsonb)) loop
    if field not in ('title',case when p_kind='tracks' then 'subtitle' else 'note' end,case when p_kind='releases' then 'defaultStatus' else 'subtitle' end) or (jsonb_typeof(entry) is distinct from 'string' and not (field='defaultStatus' and entry='null'::jsonb)) then raise sqlstate 'PT400' using message='Неизвестное поле или неверный тип.'; end if;
    if (field='title' and length(btrim(entry#>>'{}')) not between 1 and 100) or (field='subtitle' and length(entry#>>'{}')>300) or (field='note' and length(entry#>>'{}')>200) then raise sqlstate 'PT400' using message='Превышена длина поля или пустое название.'; end if;
   end loop;
   entity:=entity||coalesce(p_patch,'{}'::jsonb);if entity->'defaultStatus'='null'::jsonb then entity:=entity-'defaultStatus'; end if;
   if p_kind='releases' and coalesce(entity->>'defaultStatus','')<>'' then next_data:=jsonb_set(next_data,'{formatVersion}','2'::jsonb); end if;
   if p_position is not null and (p_position<0 or p_position>jsonb_array_length(items)-case when p_action='create' then 0 else 1 end) then raise sqlstate 'PT400' using message='Позиция вне списка.'; end if;
   index_value:=coalesce(p_position,entity_index,jsonb_array_length(items));
   if p_action='update' then items:=items-entity_index; end if;
   items:=jsonb_insert(items,array[index_value::text],entity,false);next_data:=jsonb_set(next_data,array[p_kind],items);
   -- Normalize range boundaries when releases change order, as in the editor.
   if p_kind='releases' then
    for task in select * from jsonb_array_elements(next_data->'tasks') loop
     if task ? 'releaseEnd' then
      select t.ordinality::integer into start_index from jsonb_array_elements(items) with ordinality t where t.value->>'id'=task->>'release';
      select t.ordinality::integer into end_index from jsonb_array_elements(items) with ordinality t where t.value->>'id'=task->>'releaseEnd';
      if start_index>end_index then task:=task||jsonb_build_object('release',task->>'releaseEnd','releaseEnd',task->>'release'); end if;
     end if;tasks:=tasks||jsonb_build_array(task);
    end loop;next_data:=jsonb_set(next_data,'{tasks}',tasks);
   end if;
  elsif p_action='delete' then
   if p_cards is not null and p_cards not in ('delete','move') then raise sqlstate 'PT400' using message='Выберите delete или move для карточек.'; end if;
   if p_kind='tracks' and jsonb_array_length(items)=1 then raise sqlstate 'PT400' using message='Сначала создайте другой трек для проекта.'; end if;
   if p_target_track is not null and not exists(select 1 from jsonb_array_elements(next_data->'tracks') t where t->>'id'=p_target_track and (p_kind<>'tracks' or t->>'id'<>p_entity_id)) then raise sqlstate 'PT400' using message='Неверный трек назначения.'; end if;
   if p_target_release is not null and p_target_release<>'backlog' and not exists(select 1 from jsonb_array_elements(next_data->'releases') r where r->>'id'=p_target_release and (p_kind<>'releases' or r->>'id'<>p_entity_id)) then raise sqlstate 'PT400' using message='Неверный релиз назначения.'; end if;
   for task in select * from jsonb_array_elements(next_data->'tasks') loop
    start_index:=null;end_index:=null;
    if p_kind='releases' then
     select t.ordinality::integer into start_index from jsonb_array_elements(items) with ordinality t where t.value->>'id'=task->>'release';
     select t.ordinality::integer into end_index from jsonb_array_elements(items) with ordinality t where t.value->>'id'=coalesce(task->>'releaseEnd',task->>'release');
    end if;
    if (p_kind='tracks' and task->>'track'=p_entity_id) or (p_kind='releases' and entity_index+1 between start_index and end_index) then
     affected:=affected+1;
     if p_cards is null then raise sqlstate 'PT400' using message='Явно укажите delete или move для затронутых карточек.'; end if;
     if p_cards='delete' then continue; end if;
     if p_kind='tracks' and p_target_track is null or p_kind='releases' and p_target_release is null then raise sqlstate 'PT400' using message='Укажите назначение переноса карточек.'; end if;
     if p_target_track is not null then task:=jsonb_set(task,'{track}',to_jsonb(p_target_track)); end if;
     if p_target_release is not null then task:=jsonb_set(task-'releaseEnd','{release}',to_jsonb(p_target_release)); end if;
    end if;
    tasks:=tasks||jsonb_build_array(task);
   end loop;
   next_data:=jsonb_set(jsonb_set(next_data,array[p_kind],items-entity_index),'{tasks}',tasks);
  end if;
  if is_write then select * into current_row from roadmap_private.write_project(capability.owner,p_project_id,p_expected,next_data,false); end if;
  result:=case when p_action='delete' then jsonb_build_object('removed_entity_id',p_entity_id,'affected_tasks',affected) else jsonb_build_object(case when p_kind='tracks' then 'track' else 'release' end,entity) end;
 end if;
 update roadmap_private.integration_tokens set last_used_at=clock_timestamp() where id=capability.id;
 return jsonb_build_object('id',current_row.id,'revision',current_row.revision,'deleted',false,'updated_at',current_row.updated_at)||result;
end $$;
revoke all on function public.roadmap_integration_structure(uuid,text,text,text,bigint,jsonb,integer,text,text,text,text,integer,integer) from public;
grant execute on function public.roadmap_integration_structure(uuid,text,text,text,bigint,jsonb,integer,text,text,text,text,integer,integer) to anon,authenticated;

notify pgrst, 'reload schema';
commit;
