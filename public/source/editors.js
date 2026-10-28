let editingTask=null;
function openTaskEditor(id=null,track=null,release=null){editingTask=id;$('deleteTask').hidden=!id;if(id)selected=id;const t=state.tasks.find(t=>t.id===id);$('taskDialogTitle').textContent=t?'Редактировать карточку':'Новая карточка';$('taskName').value=t?.title||'';$('taskBody').value=t?.description||'';$('taskAcceptance').value=t?.accept||'';$('taskComment').value=t?.comment||'';$('taskTrack').replaceChildren();for(const g of state.tracks)option($('taskTrack'),g.id,g.title);$('taskRelease').replaceChildren();for(const r of columns())option($('taskRelease'),r.id,r.title);$('taskTrack').value=t?.track||track||($('filter').value!=='all'?$('filter').value:state.tracks[0].id);$('taskRelease').value=t?.release||release||'backlog';$('taskState').value=t?.status||columnDefault($('taskRelease').value)||'idea';refreshTaskEnd(t?.releaseEnd||$('taskRelease').value);refreshTaskPosition();refreshSelects();$('taskDialog').showModal();$('taskName').focus()}
function refreshTaskPosition(){const peers=state.tasks.filter(t=>t.id!==editingTask&&t.track===$('taskTrack').value&&t.release===$('taskRelease').value);$('taskPosition').replaceChildren();for(let i=0;i<peers.length;i++)option($('taskPosition'),peers[i].id,String(i+1)+' · перед «'+peers[i].title+'»');option($('taskPosition'),'','В конце');const task=state.tasks.find(t=>t.id===editingTask),following=task?state.tasks.slice(state.tasks.indexOf(task)+1).find(t=>peers.includes(t)):null;$('taskPosition').value=following?.id||''}
function refreshTaskEnd(preferred=$('taskReleaseEnd').value){const start=$('taskRelease').value,index=state.releases.findIndex(r=>r.id===start);$('taskReleaseEnd').replaceChildren();if(start==='backlog'){option($('taskReleaseEnd'),'backlog','Только backlog');$('taskReleaseEnd').disabled=true}else{$('taskReleaseEnd').disabled=false;for(const release of state.releases.slice(index))option($('taskReleaseEnd'),release.id,release.title);$('taskReleaseEnd').value=[...$('taskReleaseEnd').options].some(o=>o.value===preferred)?preferred:start}}
$('taskTrack').onchange=refreshTaskPosition;$('taskRelease').onchange=()=>{refreshTaskEnd();refreshTaskPosition();const status=columnDefault($('taskRelease').value);if(status)$('taskState').value=status;refreshSelects()};

$('newTask').onclick=()=>openTaskEditor();$('taskCancel').onclick=()=>$('taskDialog').close();
$('taskForm').onsubmit=e=>{e.preventDefault();const title=$('taskName').value.trim(),description=$('taskBody').value.trim();if(!title||!description){const input=!title?$('taskName'):$('taskBody');showFieldError(input,'Заполните это поле');return}const values={title,description,track:$('taskTrack').value,release:$('taskRelease').value,status:$('taskState').value,accept:$('taskAcceptance').value.trim(),comment:$('taskComment').value.trim()};const saved=change(()=>{if(editingTask){const t=state.tasks.find(t=>t.id===editingTask);Object.assign(t,values);selected=t.id}else{const id='task-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);state.tasks.push({id,source:'',...values});selected=id}setTaskRange(selectedTask(),values.release,$('taskReleaseEnd').value);const beforeId=$('taskPosition').value;if(beforeId){const task=state.tasks.find(t=>t.id===selected);state.tasks=state.tasks.filter(t=>t!==task);state.tasks.splice(state.tasks.findIndex(t=>t.id===beforeId),0,task)}else{const task=state.tasks.find(t=>t.id===selected);state.tasks=state.tasks.filter(t=>t!==task);state.tasks.push(task)}if($('filter').value!=='all')$('filter').value=values.track;$('search').value=''},'Карточка сохранена');if(saved)$('taskDialog').close()};
for(const id of ['taskName','taskBody'])$(id).oninput=()=>$(id).setCustomValidity('');
function openRelease(id=null){
 editingRelease=id;const backlog=id==='backlog',release=backlog?{id,title:'Backlog',note:''}:state.releases.find(r=>r.id===id);
 $('releaseDialogTitle').textContent=backlog?'Настройки backlog':release?'Настройки релиза':'Создать релиз';$('releaseName').value=release?.title||'';$('releaseNote').value=release?.note||'';
 $('releaseName').closest('label').hidden=backlog;$('releaseNote').closest('label').hidden=backlog;$('releasePosition').closest('label').hidden=backlog;
 $('releasePosition').replaceChildren();for(let i=0;i<state.releases.length+(release?0:1);i++)option($('releasePosition'),String(i),String(i+1));$('releasePosition').value=String(release?state.releases.indexOf(release):state.releases.length);
 $('releaseDefaultStatus').replaceChildren();option($('releaseDefaultStatus'),'','Не менять статус');for(const [value,label] of Object.entries(labels))option($('releaseDefaultStatus'),value,label);$('releaseDefaultStatus').value=columnDefault(id)||'';
 $('deleteRelease').hidden=backlog||!release;refreshSelects();$('releaseDialog').showModal();(backlog?$('releaseDefaultStatus-trigger'):$('releaseName')).focus();
}
$('cancelRelease').onclick=()=>$('releaseDialog').close();
$('releaseForm').onsubmit=event=>{
 event.preventDefault();const backlog=editingRelease==='backlog',title=$('releaseName').value.trim(),status=$('releaseDefaultStatus').value;if(!backlog&&!title){showFieldError($('releaseName'),'Введите название');return}
 const saved=change(()=>{if(backlog){if(status){state.backlogDefaultStatus=status;state.formatVersion=2}else delete state.backlogDefaultStatus;return}
  const note=$('releaseNote').value.trim(),position=Number($('releasePosition').value);let release=state.releases.find(r=>r.id===editingRelease);if(release){release.title=title;release.note=note;state.releases=state.releases.filter(r=>r!==release)}else release={id:'rel-'+crypto.randomUUID(),title,note,locked:false};
  if(status){release.defaultStatus=status;state.formatVersion=2}else delete release.defaultStatus;state.releases.splice(position,0,release);normalizeRanges();
 });if(saved)$('releaseDialog').close();
};
$('releaseName').oninput=()=>$('releaseName').setCustomValidity('');
$('deleteRelease').onclick=()=>openEntityDeletion('release',editingRelease);
$('undo').onclick=()=>restore(undoStack,redoStack);$('redo').onclick=()=>restore(redoStack,undoStack);
for(const id of ['filter','showDone'])$(id).onchange=()=>draw(false);$('search').oninput=()=>{saveProjectView();clearTimeout(searchTimer);searchTimer=setTimeout(()=>draw(false),120)};
document.addEventListener('keydown',e=>{if(resizingCard||document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)restore(redoStack,undoStack);else restore(undoStack,redoStack)}});

let editingTrack=null;
function openTrack(id=null){
  editingTrack=id;const track=state.tracks.find(t=>t.id===id);
  $('trackDialogTitle').textContent=track?'Редактировать трек':'Новый трек';
  $('trackName').value=track?.title||'';$('trackSubtitle').value=track?.subtitle||'';
  $('trackPosition').replaceChildren();for(let i=0;i<state.tracks.length+(track?0:1);i++)option($('trackPosition'),String(i),String(i+1));
  $('trackPosition').value=String(track?state.tracks.indexOf(track):state.tracks.length);
  $('deleteTrack').hidden=!track;
  refreshSelects();$('trackDialog').showModal();$('trackName').focus();
}
$('trackCancel').onclick=()=>$('trackDialog').close();
$('trackForm').onsubmit=event=>{event.preventDefault();const title=$('trackName').value.trim();if(!title){showFieldError($('trackName'),'Введите название');return}
  const subtitle=$('trackSubtitle').value.trim(),position=Number($('trackPosition').value);
  const saved=change(()=>{let track=state.tracks.find(t=>t.id===editingTrack);if(track){track.title=title;track.subtitle=subtitle;state.tracks=state.tracks.filter(t=>t!==track)}else track={id:'track-'+crypto.randomUUID(),title,subtitle};state.tracks.splice(position,0,track)},'Трек сохранён. Доступна отмена.');if(saved)$('trackDialog').close();
};
$('trackName').oninput=()=>$('trackName').setCustomValidity('');
$('deleteTrack').onclick=()=>openEntityDeletion('track',editingTrack);

let deletingEntity=null;
function entityTasks(kind,id){return state.tasks.filter(task=>kind==='task'?task.id===id:kind==='track'?task.track===id:taskReleases(task).includes(id))}
function openEntityDeletion(kind,id){
 const entity=(kind==='task'?state.tasks:kind==='track'?state.tracks:state.releases).find(item=>item.id===id);if(!entity)return;
 deletingEntity={kind,id};const cards=entityTasks(kind,id),ranges=cards.filter(task=>task.releaseEnd).length;
 $('deleteEntityTitle').textContent=kind==='task'?'Удалить карточку?':kind==='track'?'Удалить трек?':'Удалить релиз?';
 $('deleteEntityInfo').textContent='«'+entity.title+'». '+(kind==='task'?'Карточка будет удалена.':cards.length?'Карточек: '+cards.length+'. Выберите, что с ними сделать.':'Карточек нет.')+(kind!=='task'&&ranges?' Есть карточки на несколько релизов: действие применяется ко всей карточке.':'')+' Доступна отмена.';
 $('deleteEntityError').textContent='';$('deleteAction').value=kind==='task'?'delete':'move';$('deleteActionField').hidden=kind==='task'||!cards.length;
 $('deleteTargetTrack').replaceChildren();if(kind==='release')option($('deleteTargetTrack'),'keep','Сохранить текущие треки');
 for(const track of state.tracks)if(kind!=='track'||track.id!==id)option($('deleteTargetTrack'),'track:'+track.id,track.title);
 option($('deleteTargetTrack'),'new','Новый трек в backlog');
 $('deleteTargetRelease').replaceChildren();if(kind==='track')option($('deleteTargetRelease'),'keep','Сохранить текущие релизы');option($('deleteTargetRelease'),'backlog','Backlog');
 for(const release of state.releases)if(kind!=='release'||release.id!==id)option($('deleteTargetRelease'),'release:'+release.id,release.title);
 $('deleteNewTrackName').value=(kind==='track'?entity.title:'Карточки: '+entity.title).slice(0,100);
 refreshDeletionOptions();$('deleteEntityDialog').showModal();$('deleteEntityCancel').focus();
}
function refreshDeletionOptions(){
 if(!deletingEntity)return;const {kind,id}=deletingEntity,cards=entityTasks(kind,id),moving=kind!=='task'&&cards.length>0&&$('deleteAction').value==='move',newTrack=$('deleteTargetTrack').value==='new';
 $('deleteMoveFields').hidden=!moving;$('deleteNewTrackField').hidden=!moving||!newTrack;
 $('deleteTargetRelease').disabled=!!newTrack;if(newTrack)$('deleteTargetRelease').value='backlog';
 $('deleteLastTrackNote').hidden=kind!=='track'||state.tracks.length!==1||!!moving;
 $('deleteEntityConfirm').textContent=moving?'Перенести и удалить':cards.length&&kind!=='task'?'Удалить вместе с карточками':'Удалить';refreshSelects();
}
$('deleteAction').onchange=refreshDeletionOptions;$('deleteTargetTrack').onchange=refreshDeletionOptions;
$('deleteEntityCancel').onclick=()=>$('deleteEntityDialog').close();$('deleteEntityDialog').addEventListener('close',()=>{deletingEntity=null;closeSelectMenu()});
$('deleteTask').onclick=()=>openEntityDeletion('task',editingTask);
$('deleteEntityForm').onsubmit=event=>{
 event.preventDefault();if(!deletingEntity)return;const {kind,id}=deletingEntity;
 const cards=entityTasks(kind,id),ids=new Set(cards.map(task=>task.id)),moving=kind!=='task'&&cards.length>0&&$('deleteAction').value==='move';
 const trackChoice=$('deleteTargetTrack').value,releaseChoice=$('deleteTargetRelease').value,newName=$('deleteNewTrackName').value.trim();let destinationTrack=null;
 $('deleteEntityError').textContent='';
 if(moving){
  if(trackChoice==='new'&&!newName){showFieldError($('deleteNewTrackName'),'Введите название трека');return}
  if(trackChoice!=='keep'&&trackChoice!=='new'&&!state.tracks.some(track=>'track:'+track.id===trackChoice&&(kind!=='track'||track.id!==id))){$('deleteEntityError').textContent='Выберите трек назначения.';return}
  if(releaseChoice!=='keep'&&releaseChoice!=='backlog'&&!state.releases.some(release=>'release:'+release.id===releaseChoice&&(kind!=='release'||release.id!==id))){$('deleteEntityError').textContent='Выберите релиз назначения.';return}
 }
 const saved=change(()=>{
  if(moving){
   if(trackChoice==='new'){destinationTrack='track-'+crypto.randomUUID();state.tracks.push({id:destinationTrack,title:newName,subtitle:''})}
   else if(trackChoice.startsWith('track:'))destinationTrack=trackChoice.slice(6);
   for(const task of state.tasks)if(ids.has(task.id)){if(destinationTrack)task.track=destinationTrack;if(trackChoice==='new'||releaseChoice!=='keep')setTaskRange(task,trackChoice==='new'||releaseChoice==='backlog'?'backlog':releaseChoice.slice(8))}
  }else state.tasks=state.tasks.filter(task=>!ids.has(task.id));
  if(kind==='release')state.releases=state.releases.filter(release=>release.id!==id);
  if(kind==='track'){state.tracks=state.tracks.filter(track=>track.id!==id);if(!state.tracks.length)state.tracks.push({id:'track-'+crypto.randomUUID(),title:'Новый трек',subtitle:''})}
 },moving?'Карточки перенесены, '+(kind==='track'?'трек':'релиз')+' удалён. Доступна отмена.':'Удалено. Доступна отмена.');
 if(!saved){$('deleteEntityError').textContent=$('statusMessage').textContent;return}
 if(moving){
  $('filter').value='all';if(destinationTrack)hiddenTracks.delete(destinationTrack);
  for(const task of state.tasks)if(ids.has(task.id)){hiddenTracks.delete(task.track);for(const release of taskReleases(task))if(release==='backlog'){showBacklog=true;document.documentElement.dataset.backlog='visible'}else hiddenReleases.delete(release)}draw();
 }
 $('deleteEntityDialog').close();$(kind==='task'?'taskDialog':kind==='track'?'trackDialog':'releaseDialog').close();document.querySelector('.board-scroll').focus({preventScroll:true});
};
