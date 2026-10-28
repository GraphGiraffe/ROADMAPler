const completedReleasesKey='roadmapler-show-completed-releases:'+new URL('.',location.href).pathname;
try{if(!portable)$('showDoneReleases').checked=localStorage.getItem(completedReleasesKey)!=='false'}catch{}
$('showDoneReleases').onchange=draw;
const vaultKey='roadmapler-projects:'+new URL('.',location.href).pathname;
const template=JSON.parse($('roadmapData').textContent);
let vault={version:1,active:'initial',projects:[{id:'initial',data:clone(state)}]},vaultRaw=null,vaultBlocked=false,vaultStale=false;
const projectSessions=new Map();let cloudWriting=false;
try{if(!portable){vaultRaw=localStorage.getItem(vaultKey);if(vaultRaw){const parsed=JSON.parse(vaultRaw);if(parsed.version!==1||!Array.isArray(parsed.projects)||!parsed.projects.length||!parsed.projects.some(p=>p.id===parsed.active)||new Set(parsed.projects.map(p=>p.id)).size!==parsed.projects.length)throw Error('Неподдерживаемое хранилище проектов');for(const p of parsed.projects)validateProject(p.data);vault=parsed;state=clone(vault.projects.find(p=>p.id===vault.active).data);selected=state.tasks[0]?.id;$('statusMessage').textContent=''}}}
catch(error){
 vaultBlocked=true;$('statusMessage').textContent='Хранилище не изменено: '+error.message+'. ';
 if(vaultRaw){const backup=text('button','Скачать исходные данные');backup.type='button';backup.onclick=()=>{const url=URL.createObjectURL(new Blob([vaultRaw],{type:'application/json;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='ROADMAPler-library-recovery.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000)};$('statusMessage').append(backup)}
}
const writeGuard=createVaultGuard({locks:navigator.locks,key:vaultKey+':writer',portable});
function canWriteVault(){return writeGuard.canWrite()&&!vaultBlocked&&!vaultStale}
function writeVault(next){
 writeGuard.requireWrite();if(vaultStale)throw Error('Проекты изменились в другой вкладке. Экспортируйте текущую работу и перезагрузите приложение.');
 if(!cloudWriting&&window.roadmapCloud)next=window.roadmapCloud.beforeWrite(vault,next);
 if(vaultBlocked)throw Error('Локальное хранилище недоступно или имеет неподдерживаемый формат.');
 if(!portable){if(localStorage.getItem(vaultKey)!==vaultRaw)throw Error('Проекты изменены в другой вкладке. Экспортируйте текущую работу и откройте приложение заново.');const raw=JSON.stringify(next);localStorage.setItem(vaultKey,raw);vaultRaw=raw;}
 vault=next;window.roadmapCloud?.onVaultChange();
}
function orderedProjects(projects,order){if(!order)return projects;const ranks=new Map(order.map((id,index)=>[id,index]));return [...projects].sort((a,b)=>(ranks.get(a.id)??order.length)-(ranks.get(b.id)??order.length))}
function persistProject(nextActive=vault.active,order=null){writeVault({...vault,active:nextActive,projects:orderedProjects(vault.projects.map(p=>p.id===vault.active?{...p,data:clone(state)}:p),order)})}
const viewKey='roadmapler-project-views:'+new URL('.',location.href).pathname;
const projectViews=new Map(),pendingViews=new Map(),viewEncoded=new Map();let viewStorageWarning=false,viewTimer=null;
function readProjectViews(){const raw=localStorage.getItem(viewKey);if(!raw)return new Map();const parsed=JSON.parse(raw);if(parsed.version!==1||!Array.isArray(parsed.projects)||parsed.projects.length>1000)throw Error('Неподдерживаемые настройки вида');return new Map(parsed.projects.filter(item=>Array.isArray(item)&&typeof item[0]==='string'&&item[1]&&typeof item[1]==='object'))}
const viewStorageKey=id=>viewKey+':'+encodeURIComponent(id);
try{if(!portable){for(const [id,view] of readProjectViews())projectViews.set(id,view);for(const project of vault.projects){const raw=localStorage.getItem(viewStorageKey(project.id));if(raw){const view=JSON.parse(raw);if(!view||typeof view!=='object'||Array.isArray(view))throw Error('Некорректный вид');projectViews.set(project.id,view);viewEncoded.set(project.id,raw)}}}}catch{viewStorageWarning=true;$('statusMessage').textContent='Не удалось прочитать настройки вида. Проекты сохранены отдельно.'}
function currentProjectView(){return {selected,showBacklog,hiddenTracks:[...hiddenTracks],hiddenReleases:[...hiddenReleases],filter:$('filter').value,search:$('search').value,showDone:$('showDone').checked,showDoneReleases:$('showDoneReleases').checked}}
function flushProjectViews(){
 clearTimeout(viewTimer);if(portable)return;
 for(const [id,raw] of pendingViews){try{localStorage.setItem(viewStorageKey(id),raw);pendingViews.delete(id)}catch{if(!viewStorageWarning){viewStorageWarning=true;$('statusMessage').textContent='Настройки вида действуют до закрытия приложения: хранилище недоступно.'}}}
}
function saveProjectView(){
 const view=currentProjectView();projectViews.set(vault.active,view);if(portable)return;
 const raw=JSON.stringify(view);if(viewEncoded.get(vault.active)===raw)return;viewEncoded.set(vault.active,raw);pendingViews.set(vault.active,raw);clearTimeout(viewTimer);viewTimer=setTimeout(flushProjectViews,200);
}
window.addEventListener('pagehide',()=>{saveProjectView();flushProjectViews();writeGuard.release()});
window.addEventListener('pageshow',event=>{if(event.persisted)writeGuard.start()});
document.addEventListener('visibilitychange',()=>{if(document.hidden){saveProjectView();flushProjectViews()}});
function applyProjectView(saved){
 selected=state.tasks.some(task=>task.id===saved?.selected)?saved.selected:state.tasks[0]?.id;showBacklog=typeof saved?.showBacklog==='boolean'?saved.showBacklog:true;
 document.documentElement.dataset.backlog=showBacklog?'visible':'hidden';hiddenTracks.clear();hiddenReleases.clear();
 for(const id of Array.isArray(saved?.hiddenTracks)?saved.hiddenTracks:[])if(state.tracks.some(track=>track.id===id))hiddenTracks.add(id);
 for(const id of Array.isArray(saved?.hiddenReleases)?saved.hiddenReleases:[])if(state.releases.some(release=>release.id===id))hiddenReleases.add(id);
 $('search').value=typeof saved?.search==='string'?saved.search:'';$('showDone').checked=typeof saved?.showDone==='boolean'?saved.showDone:true;$('showDoneReleases').checked=typeof saved?.showDoneReleases==='boolean'?saved.showDoneReleases:true;
 const filter=state.tracks.find(track=>track.id===saved?.filter);if(filter&&!Array.from($('filter').options).some(item=>item.value===filter.id))option($('filter'),filter.id,filter.title);$('filter').value=filter?.id||'all';
}
function rememberProject(){saveProjectView();projectSessions.set(vault.active,{undo:[...undoStack],redo:[...redoStack],...currentProjectView()})}
function activateProject(){
 clearTimeout(searchTimer);
 state=clone(vault.projects.find(p=>p.id===vault.active).data);const saved=projectSessions.get(vault.active);undoStack.length=0;redoStack.length=0;if(saved){undoStack.push(...saved.undo);redoStack.push(...saved.redo);RoadmapHistory.trim(undoStack,redoStack)}applyProjectView(projectViews.get(vault.active)||saved);draw();$('statusMessage').textContent='';document.querySelector('[role=tab][aria-selected=true]')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
// Normal startup and PWA use the same per-project preferences, outside project exports.
if(projectViews.has(vault.active))applyProjectView(projectViews.get(vault.active));
// Opening a passive tab is not a user view edit: never queue its defaults.
viewEncoded.set(vault.active,JSON.stringify(currentProjectView()));
function switchProject(id){
 if(id===vault.active)return;if(document.querySelector('dialog[open]')||importPending)return;
 try{rememberProject();if(canWriteVault())persistProject(id);else vault={...vault,active:id};activateProject()}catch(error){$('statusMessage').textContent=error.message}
}
function renderProjectTabs(){
 const tabs=$('projectTabs');tabs.replaceChildren();
 for(const project of vault.projects){const tab=text('button','','project-tab');tab.append(text('span',project.id===vault.active?state.project.name:project.data.project.name,'project-tab-label'));tab.type='button';tab.id='project-tab-'+project.id;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(project.id===vault.active));tab.tabIndex=project.id===vault.active?0:-1;tab.title=project.id===vault.active?'Изменить название: '+tab.textContent:tab.textContent;tab.onclick=()=>project.id===vault.active?openProjectName():switchProject(project.id);tabs.append(tab)}
}
$('projectTabs').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=vault.projects.findIndex(p=>p.id===vault.active),last=vault.projects.length-1;const next=event.key==='Home'?0:event.key==='End'?last:(index+(event.key==='ArrowRight'?1:-1)+vault.projects.length)%vault.projects.length;switchProject(vault.projects[next].id);document.getElementById('project-tab-'+vault.active)?.focus()};
let creatingProject=false;
function openProjectName(create=false){creatingProject=create;$('deleteProject').hidden=create;$('projectError').textContent='';$('projectDialogTitle').textContent=create?'Новый проект':'Название проекта';$('projectTitle').value=create?'':state.project.name;$('projectNote').value=create?'':state.project.description||'';$('projectPosition').replaceChildren();for(let i=0;i<vault.projects.length+(create?1:0);i++)option($('projectPosition'),String(i),String(i+1));$('projectPosition').value=String(create?vault.projects.length:vault.projects.findIndex(project=>project.id===vault.active));refreshSelects();$('projectDialog').showModal();$('projectTitle').focus();$('projectTitle').select();window.roadmapCloud?.projectSettings(create)}
$('newProject').onclick=()=>openProjectName(true);$('projectName').onclick=()=>openProjectName();$('projectCancel').onclick=()=>$('projectDialog').close();
$('projectForm').onsubmit=event=>{event.preventDefault();const name=$('projectTitle').value.trim(),description=$('projectNote').value.trim();if(!name){showFieldError($('projectTitle'),'Введите название');return}
 const position=Number($('projectPosition').value);if(!Number.isInteger(position)||position<0||position>=vault.projects.length+(creatingProject?1:0)){$('projectError').textContent='Выберите позицию вкладки.';return}
 if(!creatingProject){const order=vault.projects.filter(project=>project.id!==vault.active).map(project=>project.id);order.splice(position,0,vault.active);const changedOrder=JSON.stringify(order)!==JSON.stringify(vault.projects.map(project=>project.id));const saved=change(()=>{state.project.name=name;state.project.description=description},'Проект сохранён. Доступна отмена.',changedOrder?order:null);if(saved)$('projectDialog').close();else $('projectError').textContent=$('statusMessage').textContent;return}
 try{rememberProject();persistProject();const id='project-'+crypto.randomUUID(),data=clone(template);data.project={id,name,description,updatedAt:new Date().toISOString()};const projects=[...vault.projects];projects.splice(position,0,{id,data});writeVault({...vault,projects});$('projectDialog').close();switchProject(id)}catch(error){$('statusMessage').textContent=error.message;$('projectError').textContent=error.message}
};
$('deleteProject').onclick=()=>{$('deleteProjectMessage').textContent='Удалить «'+state.project.name+'» и все его карточки'+(vault.projects.find(p=>p.id===vault.active)?.cloud?.enabled?' на устройстве и в облаке? Без сети удаление отправится при следующем подключении.':' из этого приложения?');$('deleteProjectError').textContent='';$('deleteProjectDialog').showModal();$('cancelDeleteProject').focus()};
$('cancelDeleteProject').onclick=()=>$('deleteProjectDialog').close();
$('confirmDeleteProject').onclick=()=>{
 try{
  const removed={...clone(vault.projects.find(p=>p.id===vault.active)),data:clone(state)},projects=vault.projects.filter(p=>p.id!==vault.active);
  if(!projects.length){const id='project-'+crypto.randomUUID(),data=clone(template);data.project={id,name:'Новый проект',description:'',updatedAt:new Date().toISOString()};data.tasks=[];data.releases=[];data.sources=[];projects.push({id,data})}
  rememberProject();writeVault({...vault,active:projects[0].id,projects});$('deleteProjectDialog').close();$('projectDialog').close();activateProject();
  $('statusMessage').textContent='Проект удалён. ';const undo=text('button','Восстановить');undo.type='button';undo.onclick=()=>{try{rememberProject();persistProject();writeVault({...vault,active:removed.id,projects:[...vault.projects,removed]});activateProject();$('statusMessage').textContent='Проект восстановлен.'}catch(error){$('statusMessage').textContent=error.message}};$('statusMessage').append(undo);
 }catch(error){$('deleteProjectError').textContent=error.message}
};
$('projectTitle').oninput=()=>$('projectTitle').setCustomValidity('');
window.addEventListener('storage',event=>{if(event.key===vaultKey&&event.newValue!==vaultRaw){vaultStale=true;paintWriteAccess();$('statusMessage').textContent='Проекты изменились в другой вкладке. Текущая работа остаётся открытой; перед перезагрузкой экспортируйте её.'}});

window.addEventListener('storage',event=>{if(event.key?.startsWith(viewKey+':')){try{const id=decodeURIComponent(event.key.slice(viewKey.length+1));if(!pendingViews.has(id)){viewEncoded.delete(id);if(event.newValue)projectViews.set(id,JSON.parse(event.newValue))}}catch{}}});
