#!/usr/bin/env node
// Use a protected credentials file. Never pass a token in command-line arguments.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function run(argv,io=process){
 const [action,...args]=argv;
 const help=`Usage: integration-client.mjs ACTION [OPTIONS]
Actions: read, write, delete; get-card, search, create-card, update-card, delete-card, comment, changes
Structure: get/create/update/delete-track, search-tracks; get/create/update/delete-release, search-releases
Structure options: --id ID --file FIELDS.json --position INDEX --expected REVISION
Structure delete: --cards move|delete [--target-track ID] [--target-release ID|backlog] --confirm-delete ID
Common: --credentials FILE --project UUID --out NEW_FILE
Card: --task ID; create/update: --file FIELDS.json --expected REVISION
Comment: --task ID --file COMMENT.txt --expected REVISION (append, 1000 characters total)
Delete: --expected REVISION --confirm-delete PROJECT_UUID or TASK_ID
Search: --query TEXT --track ID --release ID --status STATUS --limit 1..100 --offset N
Changes: --since REVISION (0 requests reset); write: --file SNAPSHOT.json [--expected REVISION]
Tokens are read only from a protected credentials file. Conflicts are never retried automatically.
`;
 if(action==='--help'||action==='help'){io.stdout.write(help);return}
 const cardActions={'get-card':'get',search:'search','create-card':'create','update-card':'update','delete-card':'delete',comment:'comment'};
 if(!['read','write','delete','changes',...Object.keys(cardActions)].includes(action)&&! /^(get|create|update|delete)-(track|release)$|^search-(tracks|releases)$/.test(action||''))throw Error(help);
 const structureActions={};for(const [singular,plural] of [['track','tracks'],['release','releases']]){for(const verb of ['get','create','update','delete'])structureActions[verb+'-'+singular]={kind:plural,action:verb};structureActions['search-'+plural]={kind:plural,action:'search'}};
 const structure=structureActions[action];
 const options={},allowed=['credentials','project','out',...(structure?structure.action==='search'?['query','limit','offset']:['id',...(structure.action==='get'?[]:['expected',...(structure.action==='delete'?['cards','target-track','target-release','confirm-delete']:['file','position'])])]:({read:[],write:['file','expected'],delete:['expected','confirm-delete'],'get-card':['task'],search:['query','track','release','status','limit','offset'],'create-card':['task','file','expected'],'update-card':['task','file','expected'],'delete-card':['task','expected','confirm-delete'],comment:['task','file','expected'],changes:['since']}[action]))];
 for(let i=0;i<args.length;i+=2){if(!allowed.includes(args[i]?.slice(2))||!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--')||options[args[i]]!==undefined)throw Error('Некорректные параметры. См. --help. Токен передаётся только через файл.');options[args[i]]=args[i+1]}
 const path=options['--credentials']||join(homedir(),'.config/roadmapler/credentials.json');
 const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Файл подключения должен быть обычным файлом.');
 if(process.platform!=='win32'&&((stat.mode&0o077)!==0||stat.uid!==process.getuid()))throw Error('Закройте доступ к файлу подключения: chmod 600 FILE. Владельцем должен быть текущий пользователь.');
 const credentials=JSON.parse(await readFile(path,'utf8'));
 const {supabaseUrl,publishableKey,token}=credentials;
 if(typeof token!=='string'||!/^rmi_[0-9a-f]{64}$/.test(token))throw Error('В файле нет действительного токена ROADMAPler.');
 const url=new URL(supabaseUrl);if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Нужен HTTPS-адрес Supabase.');
 let anon=false;try{anon=JSON.parse(Buffer.from(publishableKey.split('.')[1],'base64url').toString()).role==='anon'}catch{}
 if(typeof publishableKey!=='string'||!publishableKey.startsWith('sb_publishable_')&&!anon)throw Error('Нужен публичный publishable/anon key, не административный ключ.');
 const id=options['--project']||credentials.projectId;if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))throw Error('Укажите ID облачного проекта.');
 let expected=options['--expected'],data=null;
 if(['write','create-card','update-card','comment'].includes(action)||structure&&['create','update'].includes(structure.action)&&options['--file']){
  if(!options['--file'])throw Error('Для записи нужен --file.');
  const fileStat=await lstat(options['--file']);if(!fileStat.isFile()||fileStat.size>(action==='write'?2*1024*1024:65536))throw Error('Некорректный файл или превышен размер.');
  const raw=await readFile(options['--file'],'utf8');
  if(action==='comment')data={text:raw};
  else{
   const input=JSON.parse(raw);
   if(action==='write'){
    if(input?.data&&Object.hasOwn(input,'revision')){if(input.id!==id)throw Error('Снимок относится к другому проекту.');data=input.data;expected??=input.revision}else data=input;
    if(data?.format!=='roadmap-project'||![1,2].includes(data.formatVersion))throw Error('Неподдерживаемый формат проекта.');
   }else{data=input;if(!data||Array.isArray(data)||typeof data!=='object'||!Object.keys(data).length)throw Error('Нужен непустой JSON-объект полей карточки.');}
  }
 }
 const modifying=['write','delete','create-card','update-card','delete-card','comment'].includes(action)||!!structure&&['create','update','delete'].includes(structure.action);
 if(modifying&&(!/^[1-9][0-9]*$/.test(String(expected))||!Number.isSafeInteger(Number(expected))))throw Error('Для изменения нужна положительная --expected версия либо версия из снимка API.');
 if(cardActions[action]&&action!=='search'&&(!options['--task']||options['--task'].length>200))throw Error('Нужен --task с ID карточки до 200 символов.');
 if(['delete','delete-card'].includes(action)&&options['--confirm-delete']!==(action==='delete'?id:options['--task']))throw Error('Удаление требует --confirm-delete с точным ID проекта или карточки.');
 if(structure&&structure.action!=='search'&&(!options['--id']||options['--id'].length>200))throw Error('Нужен --id сущности до 200 символов.');
 if(structure?.action==='delete'&&options['--confirm-delete']!==options['--id'])throw Error('Удаление требует --confirm-delete с точным ID сущности.');
 if(structure&&['create','update'].includes(structure.action)&&data===null&&options['--position']===undefined)throw Error('Нужен --file или --position.');
 let endpoint='roadmap_integration_access',body={p_project_id:id,p_action:action,p_expected:modifying?Number(expected):null,p_data:data};
 const integer=(key,min,max)=>{const value=options[key];if(!/^(0|[1-9][0-9]*)$/.test(value||'')||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)throw Error('Некорректное значение '+key);return Number(value)};
 if(structure){
  endpoint='roadmap_integration_structure';body={p_project_id:id,p_kind:structure.kind,p_action:structure.action};
  if(options['--id'])body.p_entity_id=options['--id'];if(modifying)body.p_expected=Number(expected);if(data!==null)body.p_patch=data;
  for(const [option,param] of [['query','query'],['cards','cards'],['target-track','target_track'],['target-release','target_release']])if(options['--'+option]!==undefined)body['p_'+param]=options['--'+option];
  for(const field of ['limit','offset','position'])if(options['--'+field]!==undefined)body['p_'+field]=integer('--'+field,field==='limit'?1:0,field==='limit'?100:100000);
 }else if(cardActions[action]){
  endpoint='roadmap_integration_cards';body={p_project_id:id,p_action:cardActions[action]};
  if(options['--task'])body.p_task_id=options['--task'];if(modifying)body.p_expected=Number(expected);if(data!==null)body.p_patch=data;
  for(const field of ['query','track','release','status'])if(options['--'+field]!==undefined)body['p_'+field]=options['--'+field];
  for(const field of ['limit','offset'])if(options['--'+field]!==undefined)body['p_'+field]=integer('--'+field,field==='limit'?1:0,field==='limit'?100:100000);
 }else if(action==='changes'){endpoint='roadmap_integration_changes';body={p_project_id:id,p_since:integer('--since',0,Number.MAX_SAFE_INTEGER)}}
 const response=await fetch(url.href.replace(/\/$/,'')+'/rest/v1/rpc/'+endpoint,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{apikey:publishableKey,'X-ROADMAPler-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 let result;try{result=await response.json()}catch{throw Error('Сервер вернул неподдерживаемый ответ.')}
 if(!response.ok){const message=response.status===409?'Конфликт версий: заново прочитайте проект и согласуйте изменения. Повторной записи не было.':result?.message||'Ошибка API '+response.status;throw Object.assign(Error(String(message).replaceAll(token,'[token]')),{status:response.status,code:result?.code})}
 const record=Array.isArray(result)?result[0]:result;if(!record||record.id!==id||!Number.isSafeInteger(Number(record.revision)))throw Error('Некорректный ответ API.');
 const text=JSON.stringify(record,null,2).replaceAll(token,'[token]')+'\n';
 if(options['--out'])await writeFile(options['--out'],text,{mode:0o600,flag:'wx'});else io.stdout.write(text);
 return JSON.parse(text);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])run(process.argv.slice(2)).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1});
