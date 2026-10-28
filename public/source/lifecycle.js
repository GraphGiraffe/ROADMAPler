// This checkpoint belongs only to an explicitly requested PWA update in this tab.
const updateKey='roadmap-update:'+new URL('.',location.href).pathname;
window.roadmapUpdate={
  cancel(){sessionStorage.removeItem(updateKey);window.roadmapCloud?.resume?.()},
  prepare(){
    closeSelectMenu();if(window.roadmapCloud?.isBusy?.())throw Error('Дождитесь завершения синхронизации.');if(document.querySelector('dialog[open]')||importPending||resizingCard||document.querySelector('.cell.over'))throw Error('Завершите редактирование или перенос, затем повторите обновление.');
    window.roadmapCloud?.pauseForUpdate?.();try{rememberProject();flushProjectViews();persistProject();
    // One shared history budget for the checkpoint; active history has priority.
    const undo=[...undoStack],redo=[...redoStack];let remaining=RoadmapHistory.maxBytes-RoadmapHistory.trim(undo,redo);
    const sessions=[...projectSessions].map(([id,saved])=>{const session={...saved,undo:id===vault.active?[]:[...saved.undo],redo:id===vault.active?[]:[...saved.redo]};remaining-=RoadmapHistory.trim(session.undo,session.redo,'undo',remaining);return [id,session]});
    const checkpoint=JSON.stringify({version:1,vaultRaw,sessions,state,undo,redo,selected,showBacklog,hiddenTracks:[...hiddenTracks],hiddenReleases:[...hiddenReleases],filter:$('filter').value,search:$('search').value,showDone:$('showDone').checked,showDoneReleases:$('showDoneReleases').checked});
    sessionStorage.setItem(updateKey,checkpoint);
    if(sessionStorage.getItem(updateKey)!==checkpoint)throw Error('Не удалось сохранить рабочее состояние. Сначала экспортируйте проект.');
    }catch(error){window.roadmapCloud?.resume?.();throw error}
  }
};
if(location.protocol==='https:'||location.protocol==='http:'){
  try{
    const raw=sessionStorage.getItem(updateKey);
    if(raw){
      const snapshot=JSON.parse(raw);
      if(snapshot.vaultRaw!==vaultRaw)throw Error('Хранилище изменилось в другой вкладке');
      if(snapshot.version!==1||!Array.isArray(snapshot.undo)||!Array.isArray(snapshot.redo))throw Error('Неподдерживаемый снимок обновления');
      validateProject(snapshot.state);
      for(const item of [...snapshot.undo,...snapshot.redo])readHistory(item);
      const sessions=new Map();
      for(const [id,session] of snapshot.sessions||[]){if(!Array.isArray(session.undo)||!Array.isArray(session.redo))throw Error('Некорректная история проекта');for(const item of [...session.undo,...session.redo])readHistory(item);RoadmapHistory.trim(session.undo,session.redo);sessions.set(id,session)}
      for(const [id,session] of sessions)projectSessions.set(id,session);
      state=snapshot.state;selected=snapshot.selected;showBacklog=snapshot.showBacklog;hiddenTracks.clear();hiddenReleases.clear();for(const id of snapshot.hiddenTracks||[])hiddenTracks.add(id);for(const id of snapshot.hiddenReleases||[])hiddenReleases.add(id);
      undoStack.length=0;redoStack.length=0;RoadmapHistory.trim(snapshot.undo,snapshot.redo);undoStack.push(...snapshot.undo);redoStack.push(...snapshot.redo);
      $('search').value=snapshot.search||'';$('showDone').checked=snapshot.showDone;$('showDoneReleases').checked=snapshot.showDoneReleases??true;
      draw();$('filter').value=snapshot.filter;draw();
      sessionStorage.removeItem(updateKey);
      $('statusMessage').textContent='Приложение обновлено. Проекты восстановлены.';
    }
  }catch(error){$('statusMessage').textContent='Восстановление после обновления: '+error.message+'. Снимок сохранён в этой вкладке.';}
}
function scheduleStatusDismiss(){clearTimeout(window.statusTimer);if($('statusMessage').textContent&&!$('statusMessage').querySelector('button'))window.statusTimer=setTimeout(()=>{$('statusMessage').textContent=''},7000)}
new MutationObserver(scheduleStatusDismiss).observe($('statusMessage'),{childList:true});scheduleStatusDismiss();
// Close the action menu when a command is chosen, including on narrow screens.
document.querySelector('.menu-panel').addEventListener('click',event=>{if(event.target.closest('button'))document.querySelector('.project-menu').open=false});
document.addEventListener('click',event=>{if(!event.target.closest('.project-menu'))document.querySelector('.project-menu').open=false});

for(const id of ['deleteTask','deleteTrack','deleteRelease'])$(id).innerHTML=toolIcon('trash');for(const id of ['taskCancel','trackCancel','cancelRelease'])$(id).innerHTML=toolIcon('close');for(const id of ['saveTask','saveTrack','saveRelease'])$(id).innerHTML=toolIcon('save');$('newTask').innerHTML=toolIcon('plus');$('newProject').innerHTML=toolIcon('plus');$('undo').innerHTML=toolIcon('undo');$('redo').innerHTML=toolIcon('redo');document.querySelector('.project-menu summary').innerHTML=toolIcon('more');
// The optional cloud module receives snapshots, never direct mutable state.
window.roadmapApp={
 portable,validate:validateProject,refreshSelects,canWrite:canWriteVault,
 getVault:()=>clone(vault),
 canApply:()=>!document.querySelector('dialog[open]')&&!importPending&&!resizingCard&&!document.activeElement?.matches('input,textarea,[contenteditable=true]'),
 emptyProject(){const id='project-'+crypto.randomUUID(),data=clone(template);data.project={id,name:'Новый проект',description:'',updatedAt:new Date().toISOString()};data.releases=[];data.tasks=[];data.sources=[];return {id,data}},
 saveVault(next,history=false){
  const previous=vault,previousActive=vault.active;rememberProject();
  const changed=history?previous.projects.filter(old=>{const updated=next.projects.find(p=>p.id===old.id);return updated&&!window.RoadmapSync.equal(updated.data,old.data)}):[];
  cloudWriting=true;try{writeVault(next)}finally{cloudWriting=false}
  for(const old of changed){const saved=projectSessions.get(old.id)||{undo:[],redo:[]};const session={...saved,undo:[...(saved.undo||[])],redo:[]};RoadmapHistory.record(session.undo,session.redo,JSON.stringify(old.data));projectSessions.set(old.id,session)}
  const old=previous.projects.find(p=>p.id===previousActive),current=vault.projects.find(p=>p.id===vault.active);
  if(previousActive!==vault.active||JSON.stringify(old?.data)!==JSON.stringify(current?.data))activateProject();else renderProjectTabs();
  window.roadmapCloud?.paint();
 }
};

draw();

// A read-only tab remains useful; only the lock owner may change projects or sync.
const writeAccessButton=text('button','','icon-button');writeAccessButton.type='button';writeAccessButton.id='writeAccess';writeAccessButton.dataset.liveOnly='';writeAccessButton.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>';document.querySelector('.header-tools').prepend(writeAccessButton);
function paintWriteAccess(){
 const text=vaultStale?'Проекты изменились в другой вкладке. Перед сохранением перезагрузите приложение.':writeGuard.mode()==='unsupported'?'Браузер не поддерживает безопасную запись. Можно просматривать и экспортировать проекты.':'Режим просмотра: изменения сохраняет другая вкладка ROADMAPler. Закройте её для продолжения.';
 writeAccessButton.hidden=portable||canWriteVault();writeAccessButton.title=text;writeAccessButton.setAttribute('aria-label',text);
}
writeAccessButton.onclick=()=>{$('statusMessage').textContent=writeAccessButton.title;if(vaultStale){const reload=text('button','Перезагрузить');reload.type='button';reload.onclick=()=>location.reload();$('statusMessage').append(' ',reload)}};
writeGuard.onChange(()=>{if(!portable&&writeGuard.canWrite()){try{if(localStorage.getItem(vaultKey)!==vaultRaw)vaultStale=true}catch{vaultBlocked=true}}paintWriteAccess();if(canWriteVault()){if(!portable)for(const [id,view] of projectViews){try{if(localStorage.getItem(viewStorageKey(id))===null&&!pendingViews.has(id)){pendingViews.set(id,JSON.stringify(view));viewTimer=setTimeout(flushProjectViews,200)}}catch{}}window.roadmapCloud?.resume?.()}});
