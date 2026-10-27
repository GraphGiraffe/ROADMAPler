#!/usr/bin/env node
// Use a protected credentials file. Never pass a token in command-line arguments.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function run(argv,io=process){
 const [action,...args]=argv;
 if(!['read','write','delete'].includes(action))throw Error('Usage: integration-client.mjs read|write|delete [--credentials FILE] [--project UUID] [--out FILE] [--file SNAPSHOT.json] [--expected VERSION] [--confirm-delete UUID]');
 const options={};
 for(let i=0;i<args.length;i+=2){if(!/^--(?:credentials|project|out|file|expected|confirm-delete)$/.test(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i]]!==undefined)throw Error('Некорректные параметры. Токен передаётся только через файл.');options[args[i]]=args[i+1]}
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
 if(action==='write'){
  if(!options['--file'])throw Error('Для записи нужен --file с проектом или снимком API.');
  const fileStat=await lstat(options['--file']);if(fileStat.size>2*1024*1024)throw Error('Входной файл превышает 2 МиБ.');
  const input=JSON.parse(await readFile(options['--file'],'utf8'));
  if(input?.data&&Object.hasOwn(input,'revision')){if(input.id!==id)throw Error('Снимок относится к другому проекту.');data=input.data;expected??=input.revision}else data=input;
  if(data?.format!=='roadmap-project'||![1,2].includes(data.formatVersion))throw Error('Неподдерживаемый формат проекта.');
 }
 if(action!=='read'&&(!/^[1-9][0-9]*$/.test(String(expected))||!Number.isSafeInteger(Number(expected))))throw Error('Для изменения нужна положительная --expected версия либо версия из снимка API.');
 if(action==='delete'&&options['--confirm-delete']!==id)throw Error('Удаление требует --confirm-delete с точным ID проекта.');
 const response=await fetch(url.href.replace(/\/$/,'')+'/rest/v1/rpc/roadmap_integration_access',{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{apikey:publishableKey,'X-ROADMAPler-Token':token,'Content-Type':'application/json'},body:JSON.stringify({p_project_id:id,p_action:action,p_expected:action==='read'?null:Number(expected),p_data:data})});
 let result;try{result=await response.json()}catch{throw Error('Сервер вернул неподдерживаемый ответ.')}
 if(!response.ok){const message=response.status===409?'Конфликт версий: заново прочитайте проект и согласуйте изменения. Повторной записи не было.':result?.message||'Ошибка API '+response.status;throw Error(String(message).replaceAll(token,'[token]'))}
 const record=Array.isArray(result)?result[0]:result;if(!record||record.id!==id||!Number.isSafeInteger(Number(record.revision)))throw Error('Некорректный ответ API.');
 const text=JSON.stringify(record,null,2)+'\n';
 if(options['--out'])await writeFile(options['--out'],text,{mode:0o600,flag:'wx'});else io.stdout.write(text);
 return record;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])run(process.argv.slice(2)).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1});
