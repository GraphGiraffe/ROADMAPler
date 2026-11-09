// Explicit, on-demand updates of this plugin's managed files. No credentials or polling.
import {readFile,writeFile,lstat,mkdtemp,rename,rm,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const manifestURL='https://graphgiraffe.github.io/ROADMAPler/api/agent-plugin/manifest.json';
const managed=['.codex-plugin/plugin.json','plugin.json','README.md','server/mcp.mjs','server/tools.mjs','server/update.mjs','server/integration-client.mjs','skills/roadmap-connect/SKILL.md','skills/roadmap-plan/SKILL.md','skills/roadmap-maintain/SKILL.md','LICENSE','NOTICE','LICENSES/PolyForm-Noncommercial-1.0.0.md','LICENSES/CC-BY-NC-SA-4.0.txt','LICENSES/MIT-legacy.txt'];
async function download(url,fetcher,max){const r=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Plugin download failed');const reader=r.body.getReader(),chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Plugin download too large')}chunks.push(value)}return Buffer.concat(chunks)}
export async function pluginStatus(root=new URL('../',import.meta.url),fetcher=fetch){
 const installed=JSON.parse(await readFile(new URL('plugin.json',root),'utf8'));
 if(installed.name!=='roadmapler'||!/^\d+\.\d+\.\d+$/.test(installed.version))throw Error('Not a ROADMAPler plugin root');
 const info=JSON.parse((await download(manifestURL,fetcher,65536)).toString());
 if(info.schemaVersion!==1||info.name!=='roadmapler'||!/^\d+\.\d+\.\d+$/.test(info.version)||info.credentialsIncluded!==false||! /^[a-f0-9]{64}$/.test(info.archive?.sha256)||!Number.isSafeInteger(info.archive.bytes)||info.archive.bytes<1||info.archive.bytes>5*1024*1024)throw Error('Invalid plugin manifest');
 const url=new URL(info.archive.url,manifestURL);if(url.origin!==new URL(manifestURL).origin||!url.href.startsWith(new URL('.',manifestURL).href)||url.search||url.hash||!url.pathname.endsWith('.zip'))throw Error('Invalid plugin archive URL');
 const a=info.version.split('.').map(Number),b=installed.version.split('.').map(Number);let newer=false;for(let i=0;i<3;i++){if(a[i]!==b[i]){newer=a[i]>b[i];break}}
 return {installed:installed.version,latest:info.version,updateAvailable:newer,archive:{...info.archive,url:url.href},api:info.api||null};
}
export function unpackStoredZip(bytes){
 const files=new Map();let pos=0;
 while(pos+30<=bytes.length&&bytes.readUInt32LE(pos)===0x04034b50){
  const flags=bytes.readUInt16LE(pos+6),method=bytes.readUInt16LE(pos+8),size=bytes.readUInt32LE(pos+18),uncompressed=bytes.readUInt32LE(pos+22),n=bytes.readUInt16LE(pos+26),extra=bytes.readUInt16LE(pos+28),start=pos+30+n+extra;
  if(flags&9||method!==0||size!==uncompressed||start+size>bytes.length)throw Error('Unsupported plugin ZIP');
  const name=bytes.subarray(pos+30,pos+30+n).toString();
  if(name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.')||files.has(name))throw Error('Unsafe plugin ZIP');
  files.set(name,bytes.subarray(start,start+size));pos=start+size;
 }
 if(pos+4>bytes.length||bytes.readUInt32LE(pos)!==0x02014b50)throw Error('Invalid plugin ZIP');
 for(const path of managed)if(!files.has(path))throw Error('Incomplete plugin ZIP');
 return files;
}
export async function updatePlugin(root=new URL('../',import.meta.url),fetcher=fetch){
 const status=await pluginStatus(root,fetcher);if(!status.updateAvailable)return {...status,updated:false,restartRequired:false};
 const bytes=await download(status.archive.url,fetcher,5*1024*1024);
 if(bytes.length!==status.archive.bytes||createHash('sha256').update(bytes).digest('hex')!==status.archive.sha256)throw Error('Plugin checksum mismatch');
 const files=unpackStoredZip(bytes),identity=JSON.parse(files.get('plugin.json').toString());if(identity.name!=='roadmapler'||identity.version!==status.latest)throw Error('Plugin identity mismatch');
 const base=resolve(fileURLToPath(root));if((await lstat(base)).isSymbolicLink())throw Error('Plugin root must not be a symlink');
 // Preserve host-owned connection manifests and all external credentials/settings.
 for(const name of managed){let path=base;for(const part of name.split('/')){path=join(path,part);try{if((await lstat(path)).isSymbolicLink())throw Error('Managed path must not be a symlink')}catch(e){if(e.code!=='ENOENT')throw e}}}
 const stage=await mkdtemp(join(base,'.roadmapler-update-')),replaced=[];let rollbackFailed=false;
 try{
  for(const name of managed){const staged=join(stage,'new',name);await mkdir(dirname(staged),{recursive:true});await writeFile(staged,files.get(name),{mode:0o644})}
  for(const name of managed){const target=resolve(base,name),backup=join(stage,'old',name);await mkdir(dirname(target),{recursive:true});await mkdir(dirname(backup),{recursive:true});let old=false;try{await rename(target,backup);old=true}catch(e){if(e.code!=='ENOENT')throw e}replaced.push({name,old});await rename(join(stage,'new',name),target)}
 }catch(error){try{for(const {name,old} of replaced.reverse()){await rm(join(base,name),{force:true});if(old)await rename(join(stage,'old',name),join(base,name))}}catch{rollbackFailed=true;throw Error('Update failed; recovery files retained in .roadmapler-update staging directory')}throw error}
 finally{if(!rollbackFailed)await rm(stage,{recursive:true,force:true})}
 return {installed:status.latest,updated:true,restartRequired:true,message:'Reload the MCP connection to use updated tools; credentials and host connection settings are preserved.'};
}

// Bootstrap for clients predating the update tools: download this file, verify its
// hash from the official manifest, then run explicitly. No code runs on import.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,path,...extra]=process.argv.slice(2);
 if(!['--check','--apply'].includes(mode)||!path||extra.length){process.stderr.write('Usage: node update.mjs --check|--apply INSTALLED_PLUGIN_ROOT\n');process.exitCode=1}
 else{const root=pathToFileURL(resolve(path)+'/');(mode==='--check'?pluginStatus(root):updatePlugin(root)).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(()=>{process.stderr.write('Plugin update failed. Check the plugin root, official package availability and write access.\n');process.exitCode=1})}
}
