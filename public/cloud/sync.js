/* Provider-neutral snapshot synchronization. Remote revisions are opaque. */
(() => {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])])) : value;
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  function plan(local, base, remote) {
    if (!remote) return base == null ? 'upload' : 'conflict';
    if (remote.deleted) return equal(local, base) ? 'remove' : 'conflict';
    if (equal(local, remote.data)) return 'ack';
    if (equal(local, base)) return 'download';
    if (base != null && equal(remote.data, base)) return 'upload';
    return 'conflict';
  }
  const bytes = value => new TextEncoder().encode(value);
  const b64 = value => {let out = ''; for (const b of new Uint8Array(value)) out += String.fromCharCode(b); return btoa(out)};
  const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  async function key(password, salt) {
    const material = await crypto.subtle.importKey('raw', bytes(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function seal(data, password) {
    if (!password) return data;
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(password,salt),bytes(JSON.stringify(data)));
    return {format:'roadmap-encrypted',version:1,salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext)};
  }
  async function open(data, password) {
    if (data?.format !== 'roadmap-encrypted') return data;
    if (data.version !== 1 || !password) throw Error('Для проекта нужен ключ шифрования.');
    try {return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(data.iv)},await key(password,unb64(data.salt)),unb64(data.ciphertext))))}
    catch {throw Error('Не удалось расшифровать проект. Проверьте ключ; данные в облаке не изменены.')}
  }
  class ApiError extends Error {constructor(message,status){super(message);this.status=status}}
  async function request(url, options={}) {
    const response = await fetch(url,{...options,cache:'no-store',signal:AbortSignal.timeout(20000)});
    const text = await response.text(); let body; try {body = text ? JSON.parse(text) : null} catch {throw new ApiError('Сервер вернул неподдерживаемый ответ.',response.status)}
    if (!response.ok) throw new ApiError(body?.message || body?.msg || body?.error_description || body?.error || 'Ошибка сервера '+response.status,response.status);
    return body;
  }
  class GitHub {
    constructor(config){this.config=config;this.root='https://api.github.com/repos/'+config.repo.split('/').map(encodeURIComponent).join('/');this.owner='github:'+config.repo.toLowerCase()+':'+config.branch;this.directory='roadmapler/projects';}
    api(path,options={}){return request(this.root+path,{...options,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+this.config.token,...options.headers}})}
    async connect(){const repo=await this.api('');if(!repo.private)throw Error('Для синхронизации выберите приватный репозиторий.');return {name:this.config.repo}}
    async list(){try{const files=await this.api('/contents/'+this.directory+'?ref='+encodeURIComponent(this.config.branch));if(!Array.isArray(files))throw Error('Папка проектов повреждена.');return files.filter(x=>/^[a-f0-9-]{36}\.json$/.test(x.name)).map(x=>({id:x.name.slice(0,-5),revision:x.sha}))}catch(e){if(e.status===404)return [];throw e}}
    async read(id,revision){
      let body;try{body=await this.api('/contents/'+this.directory+'/'+encodeURIComponent(id)+'.json?ref='+encodeURIComponent(revision||this.config.branch))}catch(e){if(e.status===404&&!revision)return null;throw e}
      if(body.encoding!=='base64'||!body.content)throw Error('Неподдерживаемый размер или формат облачного файла.');
      const record=JSON.parse(new TextDecoder().decode(unb64(body.content.replace(/\s/g,''))));if(record.format!=='roadmap-cloud'||record.version!==1||typeof record.deleted!=='boolean')throw Error('Неподдерживаемый облачный файл.');
      return {id,revision:body.sha,deleted:record.deleted,data:record.deleted?null:await open(record.data,this.config.password)};
    }
    async write(id,revision,data,deleted=false){const content={format:'roadmap-cloud',version:1,deleted,data:deleted?null:await seal(data,this.config.encrypt?this.config.password:'')};const result=await this.api('/contents/'+this.directory+'/'+encodeURIComponent(id)+'.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:deleted?'ROADMAPler: delete project':'ROADMAPler: save project',branch:this.config.branch,sha:revision||undefined,content:b64(bytes(JSON.stringify(content)))})});return {id,revision:result.content.sha,data,deleted}}
    async history(id){const commits=await this.api('/commits?path='+this.directory+'/'+encodeURIComponent(id)+'.json&sha='+encodeURIComponent(this.config.branch)+'&per_page=20');return commits.map(c=>({revision:c.sha,label:c.commit.author.date}))}
  }
  class Supabase {
    constructor(config,onSession){this.config=config;this.url=config.url.replace(/\/$/,'');this.onSession=onSession;this.owner=config.user?'supabase:'+this.url+':'+config.user.id:''}
    async auth(path,body){return request(this.url+'/auth/v1/'+path,{method:'POST',headers:{apikey:this.config.key,'Content-Type':'application/json'},body:JSON.stringify(body)})}
    async recover(email,redirect){return this.auth('recover?redirect_to='+encodeURIComponent(redirect),{email})}
    async recoveryUser(token){return request(this.url+'/auth/v1/user',{headers:{apikey:this.config.key,Authorization:'Bearer '+token}})}
    async updatePassword(token,password){return request(this.url+'/auth/v1/user',{method:'PUT',headers:{apikey:this.config.key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({password})})}
    async endRecovery(token){return request(this.url+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:this.config.key,Authorization:'Bearer '+token}})}
    async login(email,password,signup=false){const result=await this.auth(signup?'signup':'token?grant_type=password',{email,password});if(!result.access_token)return null;this.session(result);return result.user}
    session(result){Object.assign(this.config,{token:result.access_token,refresh:result.refresh_token,user:result.user,expires:Date.now()+result.expires_in*1000});this.owner='supabase:'+this.url+':'+result.user.id;this.onSession?.(this.config)}
    async connect(){if(!this.config.token)throw Error('Войдите в аккаунт.');await this.refresh();const user=await request(this.url+'/auth/v1/user',{headers:{apikey:this.config.key,Authorization:'Bearer '+this.config.token}});this.config.user=user;this.owner='supabase:'+this.url+':'+user.id;return {name:user.email}}
    async refresh(){if(this.config.expires>Date.now()+60000)return;if(!this.config.refresh)throw new ApiError('Войдите в аккаунт ещё раз.',401);this.session(await this.auth('token?grant_type=refresh_token',{refresh_token:this.config.refresh}))}
    async api(path,options={}){await this.refresh();return request(this.url+'/rest/v1/'+path,{...options,headers:{apikey:this.config.key,Authorization:'Bearer '+this.config.token,'Content-Type':'application/json',...options.headers}})}
    async list(){return this.api('roadmap_projects?select=id,revision,deleted,updated_at')}
    async read(id,revision){const rows=await this.api((revision?'roadmap_versions':'roadmap_projects')+'?select=*&id=eq.'+encodeURIComponent(id)+(revision?'&revision=eq.'+encodeURIComponent(revision):''));return rows[0]||null}
    async write(id,revision,data,deleted=false){const rows=await this.api('rpc/roadmap_write',{method:'POST',body:JSON.stringify({p_id:id,p_expected:revision||0,p_data:data,p_deleted:deleted})});return Array.isArray(rows)?rows[0]:rows}
    async history(id){return (await this.api('roadmap_versions?select=revision,updated_at&id=eq.'+encodeURIComponent(id)+'&order=revision.desc&limit=20')).map(x=>({revision:x.revision,label:x.updated_at}))}
  }
  window.RoadmapSync={equal,plan,seal,open,GitHub,Supabase,ApiError};
})();
