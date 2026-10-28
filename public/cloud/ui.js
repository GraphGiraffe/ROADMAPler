/* Optional cloud UI; portable HTML remains independent and local. */
(() => {
 'use strict';
 const app=window.roadmapApp,S=window.RoadmapSync;if(!app||app.portable)return;
 const $=id=>document.getElementById(id),copy=value=>structuredClone(value),same=S.equal;
 const key='roadmapler-cloud:'+new URL('.',location.href).pathname;
 let client=null,config=null,busy=false,timer=null,delay=1500,message='Локальный режим',phase='local',generation=0,paused=false;
 const conflicts=new Map();
 const owner=()=>client?.owner;
 const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
 const html=`<dialog id="cloudAccount" data-cloud aria-labelledby="cloudTitle"><h2 id="cloudTitle">Аккаунт</h2>
 <p id="cloudAccountState" role="status"></p><form id="cloudLogin" novalidate>
 <label>Способ синхронизации<select id="cloudProvider"><option value="supabase">ROADMAPler</option><option value="github">Мой GitHub</option></select></label>
 <div id="supabaseFields"><p id="cloudUnavailable" class="note"></p><label>Почта<input id="cloudEmail" type="email" autocomplete="username"></label><label>Пароль<input id="cloudPassword" type="password" autocomplete="current-password" minlength="12"></label></div>
 <div id="githubFields" hidden><label>Приватный репозиторий<input id="cloudRepo" placeholder="владелец/репозиторий" autocomplete="off"></label><label>Ветка<input id="cloudBranch" value="main" autocomplete="off"></label><label>Токен доступа<input id="cloudToken" type="password" autocomplete="off"></label><label class="check-label"><input id="cloudEncrypt" type="checkbox" checked> Шифровать проекты</label><label id="cloudKeyField">Ключ шифрования<input id="cloudKey" type="password" autocomplete="off"></label><p class="note">Токен: доступ Contents — чтение и запись только в выбранном репозитории. Ключ шифрования хранится только в памяти; для другого устройства нужен тот же ключ. Без ключа восстановить зашифрованные проекты нельзя.</p></div>
 <label class="check-label"><input id="cloudRemember" type="checkbox"> Запомнить подключение на этом устройстве</label><p id="cloudError" class="field-error" role="status"></p><div class="actions"><button id="cloudRegister" type="button">Регистрация</button><button id="cloudConnect" class="primary" type="submit">Войти</button></div></form>
 <section id="cloudSecurity" class="account-section"><h3>Пароль</h3><div id="cloudSecurityActions" class="actions"></div></section><section id="cloudSyncSection" class="account-section" hidden><h3>Синхронизация</h3><div class="actions"><button id="cloudRetry" type="button" hidden>Синхронизировать сейчас</button><button id="cloudResolve" type="button" hidden>Разобрать конфликт</button></div><p class="note">Локальный или облачный режим выбирается отдельно в настройках проекта.</p></section><div class="actions"><button id="cloudDisconnect" type="button" class="danger" hidden>Выйти из аккаунта</button><button id="cloudClose" type="button">Закрыть</button></div></dialog>
 <dialog id="cloudSignoutDialog" data-cloud aria-labelledby="cloudSignoutTitle"><h2 id="cloudSignoutTitle">Выйти из аккаунта?</h2><p id="cloudSignoutInfo"></p><div class="actions"><button id="cloudSignoutCancel" type="button">Отмена</button><button id="cloudSignoutConfirm" type="button" class="danger">Выйти</button></div></dialog>
 <dialog id="cloudModeDialog" data-cloud aria-labelledby="cloudModeTitle"><h2 id="cloudModeTitle">Режим проекта</h2><p id="cloudModeInfo"></p><p class="note">Локальный проект не отправляется на сервер. При отключении синхронизации уже созданная облачная копия остаётся в облаке.</p><p id="cloudModeError" class="field-error" role="status"></p><div class="actions"><button id="cloudMakeLocal" type="button">Локальный</button><button id="cloudMakeOnline" type="button" class="primary">Облачный</button><button id="cloudModeClose" type="button">Отмена</button></div></dialog>
 <dialog id="cloudConflict" data-cloud aria-labelledby="cloudConflictTitle"><h2 id="cloudConflictTitle">Изменения на двух устройствах</h2><p id="cloudConflictInfo"></p><p>«Сохранить обе» оставит облачную версию в проекте, а вашу — отдельной локальной копией. «Отправить мою» сохранит облачную версию локальной копией перед отправкой вашей.</p><p id="cloudConflictError" class="field-error" role="status"></p><div class="actions"><button id="cloudKeepBoth" type="button" class="primary">Сохранить обе</button><button id="cloudKeepMine" type="button">Отправить мою</button><button id="cloudConflictClose" type="button">Позже</button></div></dialog>
 <dialog id="cloudHistory" data-cloud aria-labelledby="cloudHistoryTitle"><h2 id="cloudHistoryTitle">Версии проекта</h2><p id="cloudHistoryInfo" role="status"></p><div id="cloudVersions"></div><div class="actions"><button id="cloudHistoryClose" type="button">Закрыть</button></div></dialog>`;
 document.querySelector('main').insertAdjacentHTML('beforeend',html);
 const accountButton=node('button','Аккаунт');accountButton.type='button';accountButton.dataset.cloud='';document.querySelector('.menu-panel').prepend(accountButton);
 const status=node('button','','cloud-status');status.type='button';status.id='cloudStatus';status.dataset.cloud='';document.querySelector('.header-tools').prepend(status);
 const projectButton=node('button','Синхронизация…');projectButton.type='button';projectButton.id='projectSync';projectButton.dataset.cloud='';$('projectForm').querySelector('.actions').prepend(projectButton);
 function cloudIcon(state='synced'){
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.7');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');icon.setAttribute('aria-hidden','true');
  icon.innerHTML=state==='syncing'?'<path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3a7 7 0 0 0 11.6-1"/>':'<path d="M6 19a4 4 0 0 1-.5-8 6.5 6.5 0 0 1 12.4-2A5 5 0 0 1 18 19Z"/>'+(state==='synced'||state==='local'?'':'<path d="M12 10v4m0 3v.1"/>');return icon;
 }
 function settings(){return window.ROADMAP_CLOUD||{}}
 function setStatus(text,state){message=text;phase=state;paint()}
 function paint(){
  status.replaceChildren(cloudIcon(phase));status.dataset.state=phase;status.title=message;status.setAttribute('aria-label',message);status.hidden=phase==='local';$('cloudAccountState').textContent=(config?(config.provider==='github'?'GitHub · ':'ROADMAPler · ')+(config.label||'')+' · ':'')+message;
  $('cloudResolve').hidden=!conflicts.size;$('cloudRetry').hidden=!client;$('cloudDisconnect').hidden=!client;$('cloudSyncSection').hidden=!client;$('cloudDisconnect').textContent=config?.provider==='github'?'Отключить GitHub':'Выйти из аккаунта';window.RoadmapRecovery?.refresh?.();
  const vault=app.getVault();for(const p of vault.projects){const tab=$('project-tab-'+p.id);if(!tab)continue;tab.querySelector('[data-cloud]')?.remove();if(p.cloud?.enabled){const mark=node('span','','cloud-tab-mark');mark.append(cloudIcon());mark.dataset.cloud='';mark.setAttribute('aria-hidden','true');tab.append(mark);tab.title=p.data.project.name+' · облачный проект'+(p.cloud.owner!==owner()?' · подключите его аккаунт':'')}}
 }
 function storeSession(value){
  const saved={...value};delete saved.password;
  try{localStorage.removeItem(key);sessionStorage.removeItem(key);(value.remember?localStorage:sessionStorage).setItem(key,JSON.stringify(saved))}catch{setStatus('Подключение действует только до закрытия приложения.','error')}
 }
 function fields(){const github=$('cloudProvider').value==='github';$('supabaseFields').hidden=github;$('githubFields').hidden=!github;$('cloudRegister').hidden=github;window.RoadmapRecovery?.refresh?.();$('cloudKeyField').hidden=!$('cloudEncrypt').checked;$('cloudUnavailable').textContent=settings().supabaseUrl&&settings().supabaseKey?'':'Облачный сервер ROADMAPler ещё не подключён. Доступны локальный режим и личный GitHub.';app.refreshSelects()}
 $('cloudProvider').onchange=fields;$('cloudEncrypt').onchange=fields;
 const switchButton=node('button','Сменить подключение');switchButton.type='button';switchButton.hidden=true;$('cloudAccount').querySelector(':scope > .actions').prepend(switchButton);switchButton.onclick=()=>{$('cloudLogin').hidden=!$('cloudLogin').hidden;switchButton.textContent=$('cloudLogin').hidden?'Сменить подключение':'Отмена смены подключения';fields()};
 const showAccount=()=>{switchButton.textContent='Сменить подключение';$('cloudLogin').hidden=!!client;switchButton.hidden=!client;fields();$('cloudError').textContent='';$('cloudAccount').showModal()};accountButton.onclick=showAccount;status.onclick=()=>conflicts.size?showConflict():showAccount();
 $('cloudClose').onclick=()=>$('cloudAccount').close();$('cloudRetry').onclick=()=>{delay=100;notify()};$('cloudResolve').onclick=()=>{$('cloudAccount').close();showConflict()};
 async function connect(register=false){
  if(busy){$('cloudError').textContent='Дождитесь завершения синхронизации.';return}
  $('cloudError').textContent='';$('cloudConnect').disabled=true;$('cloudRegister').disabled=true;
  const previous=client,previousConfig=config;const attempt=++generation;
  try{
   let nextClient,next;
   if($('cloudProvider').value==='github'){
    const repo=$('cloudRepo').value.trim(),branch=$('cloudBranch').value.trim(),token=$('cloudToken').value.trim(),password=$('cloudKey').value;
    if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||!branch||!token)throw Error('Укажите репозиторий, ветку и токен.');if($('cloudEncrypt').checked&&password.length<12)throw Error('Ключ шифрования должен содержать хотя бы 12 символов.');
    next={provider:'github',repo,branch,token,password,encrypt:$('cloudEncrypt').checked,remember:$('cloudRemember').checked};nextClient=new S.GitHub(next);
   }else{
    const {supabaseUrl:url,supabaseKey:key}=settings();if(!url||!key)throw Error('Владелец ещё не подключил облачный сервер ROADMAPler.');
    next={provider:'supabase',url,key,remember:$('cloudRemember').checked};nextClient=new S.Supabase(next,value=>{if(client===nextClient)storeSession(value)});
    const user=await nextClient.login($('cloudEmail').value.trim(),$('cloudPassword').value,register);if(!user){$('cloudError').textContent='Проверьте почту для подтверждения регистрации, затем войдите.';return}
   }
   const profile=await nextClient.connect();if(attempt!==generation)return;next.label=profile.name;client=nextClient;config=next;storeSession(next);conflicts.clear();$('cloudPassword').value='';$('cloudToken').value='';$('cloudKey').value='';$('cloudAccount').close();setStatus('Подключено: '+profile.name,'pending');delay=100;notify();
  }catch(error){client=previous;config=previousConfig;$('cloudError').textContent=error.message}
  finally{$('cloudConnect').disabled=false;$('cloudRegister').disabled=false}
 }
 $('cloudLogin').onsubmit=e=>{e.preventDefault();connect()};$('cloudRegister').onclick=()=>connect(true);
 $('cloudDisconnect').onclick=()=>{if(!client)return;const github=config?.provider==='github';$('cloudSignoutTitle').textContent=github?'Отключить GitHub?':'Выйти из аккаунта?';$('cloudSignoutConfirm').textContent=github?'Отключить':'Выйти';$('cloudSignoutInfo').textContent='Синхронизация на этом устройстве остановится. Проекты останутся на устройстве и в облаке. Для продолжения потребуется снова подключиться.';$('cloudSignoutDialog').showModal();$('cloudSignoutCancel').focus()};
 $('cloudSignoutCancel').onclick=()=>$('cloudSignoutDialog').close();
 $('cloudSignoutConfirm').onclick=()=>{const previous=client,supabase=config?.provider==='supabase';generation++;client=null;config=null;clearTimeout(timer);conflicts.clear();try{localStorage.removeItem(key);sessionStorage.removeItem(key)}catch{}$('cloudSignoutDialog').close();$('cloudAccount').close();setStatus('Аккаунт отключён. Проекты сохранены на устройстве.','local');if(previous&&supabase)previous.logout().catch(()=>{$('statusMessage').textContent='Подключение удалено с устройства. Сервер не подтвердил выход; проверьте сеть.'})};
 function projectSettings(create){projectButton.hidden=create;historyButton.hidden=create}
 projectButton.onclick=()=>{const p=app.getVault().projects.find(p=>p.id===app.getVault().active);$('cloudModeError').textContent='';$('cloudModeInfo').textContent=p.data.project.name+' · '+(p.cloud?.enabled?'облачный':'локальный')+' проект';$('cloudModeDialog').showModal()};
 $('cloudModeClose').onclick=()=>$('cloudModeDialog').close();
 function mode(enabled){try{const vault=app.getVault(),p=vault.projects.find(p=>p.id===vault.active);if(enabled&&!client)throw Error('Сначала подключите аккаунт через меню приложения.');if(enabled&&p.cloud&&p.cloud.owner!==owner())throw Error('Сначала переведите проект в локальный режим. Затем можно подключить другое облако.');p.cloud=enabled?{...(p.cloud||{id:crypto.randomUUID(),revision:null,base:null,owner:owner(),provider:config.provider}),enabled:true}:{...p.cloud,enabled:false};app.saveVault(vault);$('cloudModeDialog').close();$('projectDialog').close();paint();notify()}catch(error){$('cloudModeError').textContent=error.message}}
 $('cloudMakeLocal').onclick=()=>mode(false);$('cloudMakeOnline').onclick=()=>mode(true);
 const historyButton=node('button','Версии в облаке');historyButton.type='button';historyButton.dataset.cloud='';$('projectForm').querySelector('.actions').prepend(historyButton);
 historyButton.onclick=async()=>{
  $('cloudVersions').replaceChildren();$('cloudHistoryInfo').textContent='Загрузка…';$('cloudHistory').showModal();
  try{const p=app.getVault().projects.find(p=>p.id===app.getVault().active);if(!p.cloud?.enabled||p.cloud.owner!==owner())throw Error('Подключите аккаунт этого облачного проекта.');const boundClient=client,items=await boundClient.history(p.cloud.id);$('cloudHistoryInfo').textContent=items.length?'Выберите версию для восстановления. Текущее состояние будет доступно через отмену.':'Сохранённых версий пока нет.';
   for(const item of items){const button=node('button','Восстановить · '+new Date(item.label).toLocaleString());button.type='button';button.onclick=async()=>{button.disabled=true;try{if(client!==boundClient)throw Error('Подключение изменилось.');const record=await boundClient.read(p.cloud.id,item.revision);if(record.deleted)throw Error('Эта версия отмечает удаление; выберите предшествующую.');app.validate(record.data);const vault=app.getVault(),target=vault.projects.find(x=>x.id===p.id);if(!target||!same(target.data,p.data))throw Error('Проект изменился. Откройте историю заново.');target.data=copy(record.data);app.saveVault(vault,true);$('cloudHistory').close();$('projectDialog').close();notify()}catch(error){$('cloudHistoryInfo').textContent=error.message}finally{button.disabled=false}};$('cloudVersions').append(button)}
  }catch(error){$('cloudHistoryInfo').textContent=error.message}
 };
 $('cloudHistoryClose').onclick=()=>$('cloudHistory').close();
 function beforeWrite(previous,next){
  const pending=[...(next.cloudDeletions||[])];for(const p of next.projects){if(p.cloud?.enabled&&!previous.projects.some(old=>old.id===p.id))p.cloud.base=null}for(const p of previous.projects){if(p.cloud?.enabled&&!next.projects.some(x=>x.id===p.id)&&!pending.some(x=>x.id===p.id)){pending.push({id:p.id,cloud:copy(p.cloud),data:copy(p.data)})}}
  next.cloudDeletions=pending.filter(p=>!next.projects.some(x=>x.cloud?.enabled&&x.cloud.owner===p.cloud.owner&&x.cloud.id===p.cloud.id));return next;
 }
 function notify(){if(paused)return;if(!client){paint();return}clearTimeout(timer);timer=setTimeout(sync,delay);paint()}
 function localCopy(vault,data,suffix){if(!data)return;const id='project-'+crypto.randomUUID(),snapshot=copy(data);snapshot.project.name+=' — '+suffix;vault.projects.push({id,data:snapshot})}
 function ensureNotEmpty(vault){if(vault.projects.length){if(!vault.projects.some(p=>p.id===vault.active))vault.active=vault.projects[0].id;return}const p=app.emptyProject();vault.projects.push(p);vault.active=p.id}
 function showConflict(){const item=conflicts.values().next().value;if(!item)return;$('cloudConflictInfo').textContent='Проект «'+item.local.data.project.name+'» изменён на другом устройстве'+(item.remote?.deleted?' или удалён там.':'.');$('cloudConflictError').textContent='';$('cloudConflict').showModal()}
 $('cloudConflictClose').onclick=()=>$('cloudConflict').close();
 async function resolve(mine){
  if(!app.canWrite()){$('cloudConflictError').textContent='Разрешите конфликт во вкладке с правом записи.';return}
  const item=conflicts.values().next().value;if(!item)return;const activeClient=client,epoch=generation;if(busy){$('cloudConflictError').textContent='Дождитесь завершения обмена.';return}busy=true;
  try{
   let vault=app.getVault(),current=item.deletion?vault.cloudDeletions?.find(x=>x.id===item.local.id):vault.projects.find(x=>x.id===item.local.id);if(!current||!same(current.data,item.local.data))throw Error('Локальная версия изменилась. Закройте окно и повторите синхронизацию.');
   const latest=await activeClient.read(current.cloud.id);if(epoch!==generation||!app.canWrite())throw Error('Подключение или право записи изменилось.');vault=app.getVault();const live=item.deletion?vault.cloudDeletions?.find(x=>x.id===current.id):vault.projects.find(x=>x.id===current.id);if(!live||!same(live.data,current.data))throw Error('Локальная версия изменилась. Повторите синхронизацию.');if(!same(latest,item.remote))throw Error('Облачная версия снова изменилась. Повторите синхронизацию.');
   if(mine){
    // Save a local safety copy before attempting a remote overwrite.
    localCopy(vault,latest?.data,'облачная копия перед разрешением конфликта');app.saveVault(vault);
    const result=await activeClient.write(current.cloud.id,latest?.revision||null,current.data,item.deletion);
    if(epoch!==generation||!app.canWrite())return;vault=app.getVault();if(item.deletion)vault.cloudDeletions=vault.cloudDeletions.filter(x=>x.id!==current.id);else{const target=vault.projects.find(x=>x.id===current.id);if(target){target.cloud.revision=result.revision;target.cloud.base=copy(current.data)}}
   }else{
    localCopy(vault,current.data,'локальная копия');
    if(item.deletion)vault.cloudDeletions=vault.cloudDeletions.filter(x=>x.id!==current.id);
    if(latest&&!latest.deleted){app.validate(latest.data);let target=vault.projects.find(x=>x.id===current.id);if(!target){target={id:current.id};vault.projects.push(target)}target.data=copy(latest.data);target.cloud={...current.cloud,revision:latest.revision,base:copy(latest.data)}}else vault.projects=vault.projects.filter(x=>x.id!==current.id);
   }
   ensureNotEmpty(vault);app.saveVault(vault,true);conflicts.delete(current.id);$('cloudConflict').close();setStatus('Конфликт разрешён, копии сохранены.','pending');
  }catch(error){$('cloudConflictError').textContent=error.message}finally{busy=false;delay=300;notify()}
 }
 $('cloudKeepBoth').onclick=()=>resolve(false);$('cloudKeepMine').onclick=()=>resolve(true);
 async function sync(){
  if(!app.canWrite()){setStatus('Синхронизация доступна во вкладке с правом записи.','readonly');return}
  if(!client||busy||paused)return;if(document.hidden){timer=setTimeout(sync,30000);return}
  if(!navigator.onLine){setStatus('Нет сети. Изменения сохранены на устройстве.','offline');timer=setTimeout(sync,30000);return}
  const activeClient=client,epoch=generation;busy=true;setStatus('Синхронизация…','syncing');
  try{
   const list=await activeClient.list();if(epoch!==generation||!app.canWrite())return;const lookup=new Map(list.map(r=>[r.id,r]));
   // Deletions are durable and version checked just like edits.
   for(const removed of app.getVault().cloudDeletions||[]){if(removed.cloud.owner!==activeClient.owner)continue;const record=lookup.get(removed.cloud.id),remote=record?await activeClient.read(removed.cloud.id):null;if(epoch!==generation||!app.canWrite())return;
    if(remote&&!remote.deleted&&remote.revision!==removed.cloud.revision){conflicts.set(removed.id,{local:removed,remote,deletion:true});continue}
    if(!(app.getVault().cloudDeletions||[]).some(x=>x.id===removed.id))continue;if(remote&&!remote.deleted)await activeClient.write(removed.cloud.id,remote.revision,null,true);if(epoch!==generation||!app.canWrite())return;
    const vault=app.getVault();vault.cloudDeletions=(vault.cloudDeletions||[]).filter(x=>x.id!==removed.id);app.saveVault(vault);
   }
   for(const project of app.getVault().projects){
    if(!project.cloud?.enabled||project.cloud.owner!==activeClient.owner)continue;const head=lookup.get(project.cloud.id);
    const dirty=!same(project.data,project.cloud.base);if(head&&head.revision===project.cloud.revision&&!dirty){conflicts.delete(project.id);continue}
    let remote=head?await activeClient.read(project.cloud.id):null;if(epoch!==generation||!app.canWrite())return;
    if(remote&&!remote.deleted)app.validate(remote.data);
    const action=S.plan(project.data,project.cloud.base,remote);
    if(action==='conflict'){conflicts.set(project.id,{local:project,remote});continue}
    if((action==='download'||action==='remove')&&!app.canApply())continue;
    let result=remote;
    if(action==='upload'){
     const live=app.getVault().projects.find(p=>p.id===project.id);if(!live?.cloud?.enabled||live.cloud.owner!==activeClient.owner||!same(live.data,project.data))continue;
     try{result=await activeClient.write(project.cloud.id,remote?.revision||null,project.data)}catch(error){if(error.status===409||error.status===422){const latest=await activeClient.read(project.cloud.id);conflicts.set(project.id,{local:project,remote:latest});continue}throw error}
    }
    if(epoch!==generation||!app.canWrite())return;const vault=app.getVault(),current=vault.projects.find(x=>x.id===project.id);if(!current||current.cloud?.owner!==activeClient.owner||!current.cloud.enabled)continue;
    // User edits made while an HTTP request was in flight always win locally.
    if(!same(current.data,project.data)){if(action==='upload'||action==='ack'){current.cloud.revision=result.revision;current.cloud.base=copy(project.data);app.saveVault(vault)}continue}
    if(action==='remove'){vault.projects=vault.projects.filter(x=>x.id!==project.id);ensureNotEmpty(vault)}else{current.data=copy(result.data);current.cloud.revision=result.revision;current.cloud.base=copy(result.data)}
    app.saveVault(vault,action==='download'||action==='remove');conflicts.delete(project.id);
   }
   // Discover projects created on another device; detached local copies are not reattached.
   for(const record of list){let vault=app.getVault();if(vault.projects.some(p=>p.cloud?.owner===activeClient.owner&&p.cloud.id===record.id)||(vault.cloudDeletions||[]).some(p=>p.cloud.owner===activeClient.owner&&p.cloud.id===record.id))continue;
    const remote=await activeClient.read(record.id);if(epoch!==generation||!app.canWrite())return;if(!remote||remote.deleted)continue;app.validate(remote.data);vault=app.getVault();if(vault.projects.some(p=>p.cloud?.owner===activeClient.owner&&p.cloud.id===record.id))continue;vault.projects.push({id:'project-'+crypto.randomUUID(),data:copy(remote.data),cloud:{owner:activeClient.owner,provider:config.provider,id:record.id,revision:remote.revision,base:copy(remote.data),enabled:true}});app.saveVault(vault);
   }
   delay=1500;const pending=app.getVault().projects.some(p=>p.cloud?.enabled&&p.cloud.owner===owner()&&!same(p.data,p.cloud.base));setStatus(conflicts.size?'Есть конфликт изменений. Нажмите для выбора версии.':pending?'Изменения ожидают отправки.':'Синхронизировано.',conflicts.size?'conflict':pending?'pending':'synced');
  }catch(error){if(epoch!==generation)return;if(error.status===401)client=null;delay=Math.min(Math.max(delay*2,3000),120000);setStatus((error.status===401?'Нужен повторный вход. ':!navigator.onLine?'Нет сети. ':'Ошибка синхронизации. ')+error.message,error.status===401?'auth':'error')}
  finally{busy=false;if(client&&!paused&&epoch===generation){clearTimeout(timer);const vault=app.getVault(),pending=vault.projects.some(p=>p.cloud?.enabled&&p.cloud.owner===owner()&&!same(p.data,p.cloud.base))||(vault.cloudDeletions||[]).some(p=>p.cloud.owner===owner());timer=setTimeout(sync,conflicts.size?30000:pending?delay:Math.max(delay,15000))}}
 }
 window.roadmapCloud={beforeWrite,onVaultChange:notify,paint,projectSettings,isBusy:()=>busy,pauseForUpdate(){paused=true;clearTimeout(timer)},resume(){paused=false;notify()}};
 window.addEventListener('online',()=>{delay=100;notify()});window.addEventListener('offline',()=>setStatus(client?'Нет сети. Изменения сохранены на устройстве.':'Локальный режим',client?'offline':'local'));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){delay=100;notify()}});
 for(const id of ['projectDialog','taskDialog','releaseDialog','trackDialog'])$(id).addEventListener('close',notify);
 window.RoadmapRecovery?.init({settings,showAccount,getClient:()=>config?.provider==='supabase'?client:null});
 window.RoadmapIntegrations?.init({app,getClient:()=>config?.provider==='supabase'?client:null,getGeneration:()=>generation,showAccount});
 fields();
 try{
  const raw=localStorage.getItem(key)||sessionStorage.getItem(key);if(raw){const saved=JSON.parse(raw);$('cloudProvider').value=saved.provider;$('cloudRemember').checked=!!saved.remember;
   if(saved.provider==='github'){$('cloudRepo').value=saved.repo;$('cloudBranch').value=saved.branch;$('cloudEncrypt').checked=!!saved.encrypt;if(saved.encrypt){$('cloudToken').value=saved.token;setStatus('Введите ключ, чтобы возобновить синхронизацию GitHub.','auth')}else{config=saved;client=new S.GitHub(saved);setStatus('Ожидание синхронизации.','pending');notify()}}
   else if(saved.provider==='supabase'){config=saved;const restoredClient=new S.Supabase(saved,value=>{if(client===restoredClient)storeSession(value)});client=restoredClient;setStatus('Ожидание синхронизации.','pending');notify()}
  }
 }catch{setStatus('Не удалось восстановить подключение. Войдите заново.','auth')}
 paint();
})();
