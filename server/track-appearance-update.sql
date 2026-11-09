-- API 1.1: optional track/project appearance + discovery; no user rows modified.
begin;
create or replace function roadmap_private.validate_project(value jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare field text; item jsonb; start_index bigint; end_index bigint; status text;
begin
 if value ? 'project' and value->'project' ? 'color' and (jsonb_typeof(value->'project'->'color') is distinct from 'string' or (value->'project'->>'color') !~ '^(#[0-9a-fA-F]{6})?$') then raise sqlstate 'PT400' using message='Некорректный цвет проекта.';end if;
 if value is null or value->>'format' is distinct from 'roadmap-project' or jsonb_typeof(value->'formatVersion') is distinct from 'number' or value->'formatVersion' not in ('1'::jsonb,'2'::jsonb) or jsonb_typeof(value->'project'->'name') is distinct from 'string' then raise sqlstate 'PT400' using message='Неподдерживаемый проект.'; end if;
 foreach field in array array['tracks','releases','tasks','sources'] loop
  if jsonb_typeof(value->field) is distinct from 'array' then raise sqlstate 'PT400' using message='Некорректный список проекта.'; end if;
 end loop;
 if jsonb_array_length(value->'tracks')=0 then raise sqlstate 'PT400' using message='Проект должен содержать трек.'; end if;
 for item in select t.item from jsonb_array_elements(value->'tracks') t(item) loop
  if item ? 'icon' and (jsonb_typeof(item->'icon') is distinct from 'string' or (item->>'icon') !~ '^([a-z][a-z0-9-]{0,39})?$') or item ? 'color' and (jsonb_typeof(item->'color') is distinct from 'string' or (item->>'color') !~ '^(#[0-9a-fA-F]{6})?$') then raise sqlstate 'PT400' using message='Некорректное оформление трека.';end if;
 end loop;
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
    if not (field='title' or p_kind='tracks' and field in ('subtitle','icon','color') or p_kind='releases' and field in ('note','defaultStatus')) or (jsonb_typeof(entry) is distinct from 'string' and not (field in ('defaultStatus','icon','color') and entry='null'::jsonb)) then raise sqlstate 'PT400' using message='Неизвестное поле или неверный тип.'; end if;
    if field='icon' and entry<>'null'::jsonb and (entry#>>'{}') !~ '^([a-z][a-z0-9-]{0,39})?$' or field='color' and entry<>'null'::jsonb and (entry#>>'{}') !~ '^(#[0-9a-fA-F]{6})?$' then raise sqlstate 'PT400' using message='Некорректное оформление трека.'; end if;
    if (field='title' and length(btrim(entry#>>'{}')) not between 1 and 100) or (field='subtitle' and length(entry#>>'{}')>300) or (field='note' and length(entry#>>'{}')>200) then raise sqlstate 'PT400' using message='Превышена длина поля или пустое название.'; end if;
   end loop;
   entity:=entity||coalesce(p_patch,'{}'::jsonb);foreach field in array array['icon','color'] loop if p_kind='tracks' and entity->field='null'::jsonb then entity:=entity-field;end if;end loop;if entity->'defaultStatus'='null'::jsonb then entity:=entity-'defaultStatus'; end if;
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

-- Point updates to project metadata retain unknown fields and use the same CAS.
create or replace function public.roadmap_integration_project(p_project_id uuid,p_expected bigint,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare capability roadmap_private.integration_tokens;current_row public.roadmap_projects;next_data jsonb;metadata jsonb;field text;entry jsonb;
begin
 capability:=roadmap_private.integration_authorize(p_project_id,'write');
 select * into current_row from public.roadmap_projects p where p.owner=capability.owner and p.id=p_project_id;
 if current_row.id is null then raise sqlstate 'PT404' using message='Проект не найден.';end if;
 if current_row.deleted then raise sqlstate 'PT410' using message='Проект удалён.';end if;
 if p_expected is null or p_expected<1 then raise sqlstate 'PT400' using message='Нужна ревизия.';end if;
 if p_expected<>current_row.revision then raise sqlstate 'PT409' using message='Проект изменён.';end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb then raise sqlstate 'PT400' using message='Нужен непустой объект полей.';end if;
 for field,entry in select * from jsonb_each(p_patch) loop
  if field not in ('name','description','color') or (jsonb_typeof(entry) is distinct from 'string' and not(field='color' and entry='null'::jsonb)) then raise sqlstate 'PT400' using message='Неизвестное поле или неверный тип.';end if;
  if field='name' and length(btrim(entry#>>'{}')) not between 1 and 160 or field='description' and length(entry#>>'{}')>2000 or field='color' and entry<>'null'::jsonb and (entry#>>'{}') !~ '^(#[0-9a-fA-F]{6})?$' then raise sqlstate 'PT400' using message='Некорректные свойства проекта.';end if;
 end loop;
 metadata:=current_row.data->'project'||p_patch;if metadata->'color'='null'::jsonb then metadata:=metadata-'color';end if;
 next_data:=jsonb_set(current_row.data,'{project}',metadata);
 select * into current_row from roadmap_private.write_project(capability.owner,p_project_id,p_expected,next_data,false);
 update roadmap_private.integration_tokens set last_used_at=clock_timestamp() where id=capability.id;
 return jsonb_build_object('id',current_row.id,'revision',current_row.revision,'project',current_row.data->'project');
end $$;
revoke all on function public.roadmap_integration_project(uuid,bigint,jsonb) from public;
grant execute on function public.roadmap_integration_project(uuid,bigint,jsonb) to anon,authenticated;

-- Version discovery uses the same project-scoped integration authorization.
create or replace function public.roadmap_integration_capabilities(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare capability roadmap_private.integration_tokens;
begin
 capability:=roadmap_private.integration_authorize(p_project_id,'read');
 if not exists(select 1 from public.roadmap_projects p where p.owner=capability.owner and p.id=p_project_id and not p.deleted) then raise sqlstate 'PT410' using message='Проект недоступен.';end if;
 return jsonb_build_object('api_version','1.1','compatible_major',1,'features',jsonb_build_array('cards','comments','changes','tracks','releases','track-appearance','project-appearance'),'track_fields',jsonb_build_array('title','subtitle','icon','color'),'project_fields',jsonb_build_array('name','description','color'),'concurrency','expected revision required','catalog_url','https://graphgiraffe.github.io/ROADMAPler/api/capabilities.json','plugin_manifest_url','https://graphgiraffe.github.io/ROADMAPler/api/agent-plugin/manifest.json');
end $$;
revoke all on function public.roadmap_integration_capabilities(uuid) from public;
grant execute on function public.roadmap_integration_capabilities(uuid) to anon,authenticated;

notify pgrst, 'reload schema';
commit;
