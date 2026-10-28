-- Runs only in the temporary PostgreSQL cluster; these are synthetic test secrets.
create or replace function auth.uid() returns uuid language sql as
$$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into public.roadmap_projects(owner,id,revision,data)
select uid,'10000000-0000-4000-8000-000000000001',1,jsonb_build_object(
 'format','roadmap-project','formatVersion',1,'project',jsonb_build_object('name',name),
 'tracks',jsonb_build_array(jsonb_build_object('id','track','title','Track')),
 'releases','[]'::jsonb,'sources','[]'::jsonb,
 'tasks',jsonb_build_array(jsonb_build_object('id','card','title','Card','description','Description','track','track','release','backlog','status','idea')))
from (values ('00000000-0000-4000-8000-000000000001'::uuid,'Owner A'),('00000000-0000-4000-8000-000000000002'::uuid,'Owner B')) v(uid,name);
insert into roadmap_private.integration_tokens(id,owner,project_id,name,token_hash,prefix,can_read,can_write,can_delete,expires_at,revoked_at)
select ('20000000-0000-4000-8000-00000000000'||n)::uuid,'00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Token '||n,
 sha256(convert_to('rmi_'||repeat(ch,64),'UTF8')),'test',r,w,d,clock_timestamp()+case when n=5 then interval '-1 day' else interval '1 day' end,
 case when n=6 then now() else null end
from (values (1,'a',true,false,false),(2,'b',false,true,false),(3,'c',false,false,true),(4,'d',true,true,true),(5,'e',true,true,true),(6,'f',true,true,true)) v(n,ch,r,w,d);

create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',label; end if; end $$;
create function public.test_error(query text,expected text) returns void language plpgsql as $$
declare actual text;
begin
 begin execute query; exception when others then get stacked diagnostics actual=returned_sqlstate; end;
 perform public.test_assert(actual=expected,format('expected %s, got %s: %s',expected,coalesce(actual,'success'),query));
end $$;
create function public.test_header(ch text) returns void language sql as
$$select set_config('request.headers',jsonb_build_object('x-roadmapler-token','rmi_'||repeat(ch,64))::text,false)$$;

-- Exercise public entrypoints under their actual client roles, not as database owner.
set role anon;
do $$
declare project text:='10000000-0000-4000-8000-000000000001'; endpoint text; secret text; result jsonb;
 reads text[]:=array[
 'select * from public.roadmap_integration_access(%L)',
 'select public.roadmap_integration_cards(%L)',
 'select public.roadmap_integration_structure(%L,''tracks'')',
 'select public.roadmap_integration_changes(%L,0)'];
 writes text[]:=array[
 'select * from public.roadmap_integration_access(%L,''write'',1,''{}''::jsonb)',
 'select public.roadmap_integration_cards(%L,''update'',''card'',1,''{"title":"changed"}''::jsonb)',
 'select public.roadmap_integration_structure(%L,''tracks'',''update'',''track'',1,''{"title":"changed"}''::jsonb)'];
begin
 foreach secret in array array['','bad-token','rmi_'||repeat('0',64),'rmi_'||repeat('e',64),'rmi_'||repeat('f',64)] loop
  perform set_config('request.headers',jsonb_build_object('x-roadmapler-token',secret)::text,false);
  foreach endpoint in array reads||writes||array['select * from public.roadmap_integration_access(%L,''delete'',1)'] loop
   perform public.test_error(format(endpoint,project),'PT401');
  end loop;
 end loop;
 perform public.test_header('d');
 foreach endpoint in array reads||writes||array['select * from public.roadmap_integration_access(%L,''delete'',1)'] loop
  perform public.test_error(format(endpoint,'10000000-0000-4000-8000-000000000002'),'PT403');
  perform public.test_error(format(endpoint,null),'PT403');
 end loop;
 perform public.test_header('a');
 foreach endpoint in array reads loop execute format(endpoint,project); end loop;
 foreach endpoint in array writes||array['select * from public.roadmap_integration_access(%L,''delete'',1)'] loop
  perform public.test_error(format(endpoint,project),'PT403');
 end loop;
 perform public.test_header('b');
 foreach endpoint in array reads loop perform public.test_error(format(endpoint,project),'PT403'); end loop;
 perform public.test_error(format('select * from public.roadmap_integration_access(%L,''delete'',1)',project),'PT403');
 perform public.test_header('c');
 foreach endpoint in array reads||writes loop perform public.test_error(format(endpoint,project),'PT403'); end loop;
 -- Removing entities requires write, even when full-project delete is allowed.
 perform public.test_error(format('select public.roadmap_integration_cards(%L,''delete'',''card'',1)',project),'PT403');
 perform public.test_error(format('select public.roadmap_integration_structure(%L,''tracks'',''delete'',''track'',1)',project),'PT403');
 perform public.test_header('d');
 perform public.test_error(format('select * from public.roadmap_integration_access(%L,''unknown'')',project),'PT400');
 perform public.test_error(format('select * from public.roadmap_integration_access(%L,null)',project),'PT400');
 perform public.test_error('select * from roadmap_private.integration_tokens','42501');
 perform public.test_error(format('select roadmap_private.integration_authorize(%L,''read'')',project),'42501');
 -- Identical project IDs for two accounts never expose the other account's data.
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
 perform public.test_assert((select data->'project'->>'name'='Owner A' from public.roadmap_integration_access(project::uuid)),'token owner isolation');
end $$;
reset role;
select public.test_assert((select last_used_at is not null from roadmap_private.integration_tokens where name='Token 1'),'successful read records use');
select public.test_assert((select last_used_at is null from roadmap_private.integration_tokens where name='Token 2'),'denial does not record use');

set role authenticated;
select public.test_header('a');
select public.test_assert((select revision=1 from public.roadmap_integration_access('10000000-0000-4000-8000-000000000001')),'authenticated role uses same token check');
-- Another account cannot revoke or list this token.
select public.test_assert(not public.roadmap_integration_revoke('20000000-0000-4000-8000-000000000001'),'cross-owner revoke denied');
select public.test_assert((select count(*)=0 from public.roadmap_integration_list()),'cross-owner list empty');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.test_assert(public.roadmap_integration_revoke('20000000-0000-4000-8000-000000000001'),'owner revokes token');
select public.test_error('select * from public.roadmap_integration_access(''10000000-0000-4000-8000-000000000001'')','PT401');
reset role;

-- A write-only token may write, but cannot read or delete a whole project.
set role anon;
select public.test_header('b');
select public.test_assert((select revision=2 from public.roadmap_integration_access('10000000-0000-4000-8000-000000000001','write',1,
 '{"format":"roadmap-project","formatVersion":1,"project":{"name":"Updated A"},"tracks":[{"id":"track","title":"Track"}],"releases":[],"sources":[],"tasks":[{"id":"card","title":"Card","description":"Description","track":"track","release":"backlog","status":"idea"}]}')),'full writer increments revision');
select public.test_assert(public.roadmap_integration_cards('10000000-0000-4000-8000-000000000001','update','card',2,'{"title":"Changed card"}')->>'revision'='3','card writer increments same revision');
select public.test_assert(public.roadmap_integration_structure('10000000-0000-4000-8000-000000000001','tracks','update','track',3,'{"title":"Changed track"}')->>'revision'='4','structure writer increments same revision');
select public.test_header('d');
select public.test_error('select * from public.roadmap_integration_access(''10000000-0000-4000-8000-000000000001'',''write'',1,(select data from public.roadmap_integration_access(''10000000-0000-4000-8000-000000000001'')))','PT409');
select public.test_error('select public.roadmap_integration_cards(''10000000-0000-4000-8000-000000000001'',''update'',''card'',1,''{"title":"stale"}'')','PT409');
select public.test_error('select public.roadmap_integration_structure(''10000000-0000-4000-8000-000000000001'',''tracks'',''update'',''track'',1,''{"title":"stale"}'')','PT409');
select public.test_assert((select revision=4 and data->'tasks'->0->>'title'='Changed card' from public.roadmap_integration_access('10000000-0000-4000-8000-000000000001')),'conflicts preserve current data');
select public.test_header('c');
select public.test_assert((select deleted and revision=5 from public.roadmap_integration_access('10000000-0000-4000-8000-000000000001','delete',4)),'delete-only token tombstones project');
select public.test_header('d');
select public.test_assert((select deleted from public.roadmap_integration_access('10000000-0000-4000-8000-000000000001')),'full read returns tombstone');
select public.test_error('select * from public.roadmap_integration_access(''10000000-0000-4000-8000-000000000001'',''write'',5,''{}'')','PT410');
select public.test_error('select public.roadmap_integration_cards(''10000000-0000-4000-8000-000000000001'')','PT410');
select public.test_assert((public.roadmap_integration_changes('10000000-0000-4000-8000-000000000001',4)->>'deleted')::boolean,'delta returns tombstone');
reset role;
select public.test_assert((select not deleted and revision=1 and data->'project'->>'name'='Owner B' from public.roadmap_projects where owner='00000000-0000-4000-8000-000000000002'),'other account unchanged');
select public.test_assert((select last_used_at is not null from roadmap_private.integration_tokens where name='Token 2'),'successful write records use');
select public.test_assert((select last_used_at is not null from roadmap_private.integration_tokens where name='Token 3'),'successful deletion records use');
select public.test_assert(not has_function_privilege('anon','roadmap_private.integration_authorize(uuid,text)','EXECUTE') and not has_function_privilege('authenticated','roadmap_private.integration_authorize(uuid,text)','EXECUTE'),'private helper has no client grants');
select public.test_assert(not (select prosecdef from pg_proc where oid='roadmap_private.integration_authorize(uuid,text)'::regprocedure),'helper is security invoker');
