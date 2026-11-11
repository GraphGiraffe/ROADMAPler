let releaseWidthPreview=null,releaseResizeCancel=null;
// Width is a portable layout hint; unsupported values keep the single-column layout.
function releaseColumnCount(release){if(releaseWidthPreview&&releaseWidthPreview.id===release?.id)return releaseWidthPreview.count;const count=release?.id==='backlog'?state.backlogColumnCount:release?.columnCount;return Number.isInteger(count)&&count>=1&&count<=5?count:1}
function releaseGrid(cols){let line=2;return cols.map(release=>{const start=line;line+=isCollapsed(release.id)?1:releaseColumnCount(release);return {start,end:line}})}
function releaseTemplate(cols){return 'var(--label) '+cols.map(r=>isCollapsed(r.id)?'var(--collapsed-col)':r.id==='add-release'?'var(--add-col)':'repeat('+releaseColumnCount(r)+',var(--col))').join(' ')}
function previewReleaseColumns(cols){
 const grid=releaseGrid(cols),template=releaseTemplate(cols),board=$('board');board.style.gridTemplateColumns=template;
 for(const [index,head] of [...board.querySelectorAll(':scope > .head[data-release]')].entries())head.style.gridColumn=grid[index].start+' / '+grid[index].end;
 for(const row of board.querySelectorAll(':scope > .track-row')){
  row.boardGrid=grid;row.style.gridTemplateColumns=template;
  for(const [index,cell] of [...row.querySelectorAll(':scope > .row-cell')].entries())cell.style.gridColumn=grid[index].start+' / '+grid[index].end;
  for(const card of row.querySelectorAll(':scope > .card')){const span=card.boardSpan;card.boardPlacement={start:grid[span.start].start,end:grid[span.end].end,lanes:span.lanes}}
  if(!row.classList.contains('collapsed-row'))layoutTrackCards(row);
 }
}
function saveReleaseWidth(id,count){change(()=>{const release=state.releases.find(r=>r.id===id);if(!release)return;if(count===1)delete release.columnCount;else release.columnCount=count},'Ширина релиза сохранена')}
function addReleaseWidthHandle(header,release,cols){
 const handle=text('button','','release-resize');handle.type='button';handle.title='Потяните, чтобы изменить ширину релиза';handle.setAttribute('aria-label','Ширина релиза: '+release.title);handle.setAttribute('role','slider');handle.setAttribute('aria-valuemin','1');handle.setAttribute('aria-valuemax','5');handle.setAttribute('aria-valuenow',String(releaseColumnCount(release)));handle.setAttribute('aria-orientation','horizontal');
 handle.innerHTML='<svg viewBox="0 0 12 24" aria-hidden="true"><path d="M4 5v14M8 5v14"/></svg>';header.classList.add('resizable-release');header.append(handle);
 handle.onclick=event=>event.stopPropagation();
 handle.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const old=releaseColumnCount(release),count=event.key==='Home'?1:event.key==='End'?5:Math.max(1,Math.min(5,old+(event.key==='ArrowRight'?1:-1)));if(count!==old){saveReleaseWidth(release.id,count);[...$('board').querySelectorAll('.head[data-release]')].find(head=>head.dataset.release===release.id)?.querySelector('.release-resize')?.focus({preventScroll:true})}};
 handle.onpointerdown=event=>{
  if(event.button!==0||!event.isPrimary||resizingCard||releaseResizeCancel)return;event.preventDefault();event.stopPropagation();closeSelectMenu();
  const scroll=$('board').parentElement,old=releaseColumnCount(release),unit=header.getBoundingClientRect().width/old,startX=event.clientX,startScroll=scroll.scrollLeft;
  let x=startX,count=old,frame,moved=false,finished=false;handle.setPointerCapture(event.pointerId);document.body.classList.add('resizing-release');
  const preview=()=>{const next=Math.max(1,Math.min(5,Math.round(old+(x-startX+scroll.scrollLeft-startScroll)/unit)));if(next===count)return;count=next;releaseWidthPreview={id:release.id,count};handle.setAttribute('aria-valuenow',String(count));previewReleaseColumns(cols)};
  const tick=()=>{if(moved){const rect=scroll.getBoundingClientRect();if(x>rect.right-28&&count<5)scroll.scrollLeft+=8;else if(x<rect.left+28&&count>1)scroll.scrollLeft-=8;preview()}frame=requestAnimationFrame(tick)};
  const move=e=>{if(e.pointerId!==event.pointerId)return;x=e.clientX;moved ||= Math.abs(x-startX)>5;if(moved)preview()};
  const finish=(commit,redraw=true)=>{if(finished)return;finished=true;cancelAnimationFrame(frame);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',cancel);handle.removeEventListener('lostpointercapture',cancel);document.removeEventListener('keydown',escape);window.removeEventListener('blur',cancel);releaseResizeCancel=null;releaseWidthPreview=null;document.body.classList.remove('resizing-release');if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);if(commit&&count!==old)saveReleaseWidth(release.id,count);else if(redraw){handle.setAttribute('aria-valuenow',String(old));previewReleaseColumns(cols)}};
  const up=e=>{if(e.pointerId===event.pointerId){move(e);finish(true)}},cancel=()=>finish(false),escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false)}};
  releaseResizeCancel=()=>finish(false,false);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',cancel);handle.addEventListener('lostpointercapture',cancel);document.addEventListener('keydown',escape);window.addEventListener('blur',cancel);frame=requestAnimationFrame(tick);
 };
}
function taskReleases(task){
 if(task.release==='backlog')return ['backlog'];
 const start=state.releases.findIndex(r=>r.id===task.release),end=state.releases.findIndex(r=>r.id===(task.releaseEnd||task.release));
 return state.releases.slice(start,Math.max(start,end)+1).map(r=>r.id);
}
function columnDefault(id){return id==='backlog'?state.backlogDefaultStatus:state.releases.find(r=>r.id===id)?.defaultStatus}
function setTaskRange(task,start,end=start){
 task.release=start;delete task.releaseEnd;
 if(start!=='backlog'&&end!==start){task.releaseEnd=end;state.formatVersion=2}
}
function normalizeRanges(){for(const task of state.tasks)if(task.releaseEnd){const a=state.releases.findIndex(r=>r.id===task.release),b=state.releases.findIndex(r=>r.id===task.releaseEnd);if(a>b)[task.release,task.releaseEnd]=[task.releaseEnd,task.release];if(a===b)delete task.releaseEnd}}
function moveTask(id,track,release,beforeId=null){
 change(()=>{const task=state.tasks.find(t=>t.id===id);if(!task)return;const changedRelease=task.release!==release,duration=task.release==='backlog'?1:taskReleases(task).length;task.track=track;
 if(release==='backlog')setTaskRange(task,release);else{const index=state.releases.findIndex(r=>r.id===release);setTaskRange(task,release,state.releases[Math.min(state.releases.length-1,index+duration-1)].id)}
 const status=columnDefault(release);if(changedRelease&&status)task.status=status;
 if(beforeId&&beforeId!==id){state.tasks=state.tasks.filter(t=>t.id!==id);const index=state.tasks.findIndex(t=>t.id===beforeId);state.tasks.splice(index<0?state.tasks.length:index,0,task)}
 });
}
function detail(){if(!selectedTask())selected=state.tasks[0]?.id;document.querySelectorAll('.card').forEach(c=>c.classList.toggle('selected',c.dataset.id===selected))}
let resizingCard=false;
function releaseAtX(x){
 const headers=[...document.querySelectorAll('.head[data-release]')];
 return headers.find(h=>{const rect=h.getBoundingClientRect();return x>=rect.left&&x<=rect.right})?.dataset.release;
}
function addRangeHandle(card,task){
 if(task.release==='backlog')return;
 const handle=text('button','','range-resize');handle.type='button';handle.title='Растянуть на релизы';handle.setAttribute('aria-label','Изменить диапазон релизов: '+task.title);handle.innerHTML='<svg viewBox="0 0 16 24" width="12" height="22" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 5v14M10 5v14"/></svg>';
 handle.onclick=event=>event.stopPropagation();
 handle.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const start=state.releases.findIndex(r=>r.id===task.release),end=state.releases.findIndex(r=>r.id===(task.releaseEnd||task.release)),next=Math.max(start,Math.min(state.releases.length-1,end+(event.key==='ArrowRight'?1:-1)));change(()=>setTaskRange(task,task.release,state.releases[next].id),'Диапазон карточки сохранён')};
 handle.onpointerdown=event=>{
  if(event.button!==0)return;event.preventDefault();event.stopPropagation();closeSelectMenu();
  const start=state.releases.findIndex(r=>r.id===task.release),oldEnd=task.releaseEnd||task.release,scroll=document.querySelector('.board-scroll');
  let end=state.releases.findIndex(r=>r.id===oldEnd),x=event.clientX,frame;
  resizingCard=true;card.draggable=false;card.classList.add('resizing');handle.setPointerCapture(event.pointerId);
  const preview=()=>{const id=releaseAtX(x);if(id&&id!=='backlog'){const index=state.releases.findIndex(r=>r.id===id);if(index>=0)end=Math.max(start,index)}else if(x>scroll.getBoundingClientRect().right-30)end=state.releases.length-1;
   const cols=card.parentElement.boardColumns,covered=cols.map((release,index)=>({index,position:state.releases.findIndex(r=>r.id===release.id),id:release.id})).filter(r=>r.position>=start&&r.position<=end&&!isCollapsed(r.id));if(!covered.length)return;const grid=card.parentElement.boardGrid;card.style.gridColumn=grid[covered[0].index].start+' / '+grid[covered.at(-1).index].end;handle.setAttribute('aria-label','До релиза '+state.releases[end].title);
  };
  const tick=()=>{const rect=scroll.getBoundingClientRect();if(x>rect.right-38)scroll.scrollLeft+=12;else if(x<rect.left+38)scroll.scrollLeft-=12;preview();frame=requestAnimationFrame(tick)};
  const move=e=>{x=e.clientX;preview()};
  const finish=commit=>{cancelAnimationFrame(frame);resizingCard=false;card.draggable=true;card.classList.remove('resizing');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',cancel);document.removeEventListener('keydown',escape);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);if(commit&&state.releases[end].id!==oldEnd)change(()=>setTaskRange(task,task.release,state.releases[end].id),'Диапазон карточки сохранён');else draw()};
  const up=()=>finish(true),cancel=()=>finish(false),escape=e=>{if(e.key==='Escape'){e.preventDefault();finish(false)}};
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',cancel);document.addEventListener('keydown',escape);frame=requestAnimationFrame(tick);
 };
 card.append(handle);
}
function createCard(task){
 const card=text('div','','card '+task.status);card.dataset.id=task.id;card.draggable=true;
 const open=text('button','','card-open');open.type='button';open.append(text('strong',task.title),text('small',labels[task.status]));
 if(task.releaseEnd){const first=state.releases.find(r=>r.id===task.release),last=state.releases.find(r=>r.id===task.releaseEnd);open.append(text('small',first.title+' → '+last.title,'range-caption'))}
 open.onclick=()=>openTaskEditor(task.id);
 const edit=text('button','','edit-entity');edit.type='button';edit.innerHTML=toolIcon('edit');edit.setAttribute('aria-label','Редактировать карточку '+task.title);edit.onclick=()=>openTaskEditor(task.id);
 card.append(statusMark(task.status),open,edit);addRangeHandle(card,task);
 card.ondragstart=event=>{if(resizingCard){event.preventDefault();return}event.dataTransfer.setData('text/plain',task.id);event.dataTransfer.effectAllowed='move'};
 return card;
}
// Stack each column independently; a spanning card waits for every covered column.
function layoutTrackCards(row){
 const bottoms=[],cards=[...row.querySelectorAll(':scope > .card')];
 for(const card of cards){
  const placement=card.boardPlacement;let {start,end}=placement;
  if(placement.lanes){for(let col=start+1;col<end;col++)if((bottoms[col]||0)<(bottoms[start]||0))start=col;end=start+1}
  card.style.gridColumn=start+' / '+end;
  const style=getComputedStyle(card),before=parseFloat(style.marginTop)||0,after=parseFloat(style.marginBottom)||0;
  let top=0;for(let col=start;col<end;col++)top=Math.max(top,bottoms[col]||0);
  card.style.transform='translateY('+top+'px)';
  const bottom=top+card.getBoundingClientRect().height+before+after;
  for(let col=start;col<end;col++)bottoms[col]=bottom;
 }
 const style=getComputedStyle(row),reserve=parseFloat(style.getPropertyValue('--add-row'))||40,empty=parseFloat(style.getPropertyValue('--empty-row'))||78;
 row.style.gridTemplateRows='minmax('+Math.max(empty,Math.ceil(Math.max(0,...bottoms.filter(Number.isFinite))+reserve))+'px,auto)';
}
const cardSizeObserver=new ResizeObserver(entries=>{if(resizingCard)return;for(const row of new Set(entries.map(e=>e.target.parentElement)))if(row?.isConnected)layoutTrackCards(row)});
function releaseNote(release){
 const details=text('details','','release-note-disclosure'),summary=text('summary','Комментарий');
 details.open=noteVisibility.has(release.id)?noteVisibility.get(release.id):!$('compactBoard').checked&&!matchMedia('(max-width:760px)').matches;
 details.append(summary,text('p',release.note,'release-note'));
 let last=details.open;const project=vault.active;
 const remember=()=>{if(last===details.open)return;last=details.open;if(!details.isConnected||vault.active!==project)return;noteVisibility.set(release.id,details.open);saveProjectView()};
 details.ontoggle=remember;
 summary.onclick=event=>{event.preventDefault();details.open=!details.open;remember()};
 return details;
}
function draw(full=true){
 if(releaseResizeCancel)releaseResizeCancel();
 const scroller=$('board').parentElement,scrollTop=scroller.scrollTop,scrollLeft=scroller.scrollLeft,pageX=window.scrollX,pageY=window.scrollY;
 clearTimeout(searchTimer);scroller.classList.toggle('compact-board',$('compactBoard').checked);
 if(full!==false)renderProjectTabs();$('projectName').textContent=state.project?.name||'Проект';$('projectDescription').textContent=state.project?.description||'';
 const filter=$('filter').value,cols=[...state.releases.filter(release=>$('showDoneReleases').checked||!completedRelease(release.id)),{id:'add-release'},{id:'backlog',title:'Backlog',note:''}],grid=releaseGrid(cols),template=releaseTemplate(cols);
 $('filter').replaceChildren();option($('filter'),'all','Все треки');for(const track of state.tracks)option($('filter'),track.id,track.title);$('filter').value=state.tracks.some(t=>t.id===filter)?filter:'all';
 const board=$('board');cardSizeObserver.disconnect();board.replaceChildren();board.style.gridTemplateColumns=template;
 const corner=text('div','Треки','head corner');corner.append(text('p','Релизы →'));board.append(corner);
 for(const [index,release] of cols.entries()){
  const header=text('div','','head');header.dataset.release=release.id;header.style.gridColumn=grid[index].start+' / '+grid[index].end;
  const status=columnDefault(release.id);if(status){header.classList.add('has-default');header.dataset.defaultStatus=status;header.append(statusMark(status))}else if(release.id==='backlog')header.classList.add('backlog-head');
  if(isCollapsed(release.id)){header.classList.add('collapsed-head');const tools=text('div','','column-tools');tools.append(visibilityButton(true,'Показать '+release.title,()=>toggleRelease(release.id)));header.append(tools);board.append(header);continue}
  if(release.id==='add-release'){header.classList.add('add-column');const add=text('button','','add-board-button');add.type='button';add.innerHTML=toolIcon('plus');add.title='Добавить релиз';add.setAttribute('aria-label',add.title);add.onclick=()=>openRelease();header.append(add);board.append(header);continue}
  const heading=text('h2',''),name=text('button',release.title,'name-button');name.type='button';name.title='Настройки '+release.title;name.onclick=()=>openRelease(release.id);heading.append(name);header.append(heading);
  if(typeof release.note==='string'&&release.note.trim())header.append(releaseNote(release));if(status)header.append(text('p',labels[status],'column-default-label'));
  header.append(text('p',state.tasks.filter(t=>taskReleases(t).includes(release.id)).length+' карточек'));
  const tools=text('div','','column-tools');if(!release.locked){const edit=text('button','','edit-entity');edit.type='button';edit.innerHTML=toolIcon('edit');edit.setAttribute('aria-label','Редактировать '+(release.id==='backlog'?'backlog':'релиз '+release.title));edit.onclick=()=>openRelease(release.id);tools.append(edit)}
  tools.append(visibilityButton(false,'Скрыть '+release.title,()=>toggleRelease(release.id)));header.append(tools);if(release.id!=='backlog'&&!release.locked)addReleaseWidthHandle(header,release,cols);board.append(header);
 }
 const query=$('search').value.trim().toLocaleLowerCase('ru');let visible=0;
 for(const track of state.tracks){
  if($('filter').value!=='all'&&$('filter').value!==track.id)continue;
  const row=text('div','','track-row');row.style.gridTemplateColumns=template;row.boardColumns=cols;row.boardGrid=grid;row.dataset.track=track.id;
  if(hiddenTracks.has(track.id)){row.classList.add('collapsed-row');const label=text('div','','track collapsed-track');label.append(text('small',track.title));const tools=text('div','','track-tools'),edit=text('button','','edit-entity');edit.type='button';edit.innerHTML=toolIcon('edit');edit.setAttribute('aria-label','Редактировать трек '+track.title);edit.onclick=()=>openTrack(track.id);tools.append(edit,visibilityButton(true,'Показать трек '+track.title,()=>{hiddenTracks.delete(track.id);draw()}));label.append(tools);decorateTrack(label,track);row.append(label);const fill=text('div','','collapsed-track-fill');fill.style.gridColumn='2 / -1';row.append(fill);board.append(row);continue}
  const tasks=state.tasks.filter(t=>t.track===track.id&&($('showDone').checked||t.status!=='done')&&(!query||(t.title+' '+t.description).toLocaleLowerCase('ru').includes(query)));
  if(query&&!tasks.length)continue;
  const placements=[];
  for(const task of tasks){const covered=taskReleases(task).filter(id=>cols.some(column=>column.id===id)&&!isCollapsed(id));if(!covered.length)continue;placements.push({task,start:cols.findIndex(r=>r.id===covered[0]),end:cols.findIndex(r=>r.id===covered.at(-1))})}
  const height=0;
  const label=text('div','','track');label.style.gridRow='1 / span '+(height+1);label.style.gridColumn='1';
  const name=text('button',track.title,'name-button');name.type='button';name.title='Редактировать трек';name.onclick=()=>openTrack(track.id);label.append(name,text('small',track.subtitle,'track-subtitle'),text('small',tasks.length+' карточек','track-count'));
  const edit=text('button','','edit-entity');edit.type='button';edit.innerHTML=toolIcon('edit');edit.setAttribute('aria-label','Редактировать трек '+track.title);edit.onclick=()=>openTrack(track.id);const tools=text('div','','track-tools');tools.append(edit,visibilityButton(false,'Скрыть трек '+track.title,()=>{hiddenTracks.add(track.id);draw()}));label.append(tools);decorateTrack(label,track);row.append(label);
  for(const [index,release] of cols.entries()){
   const cell=text('div','','cell row-cell'+(isCollapsed(release.id)?' collapsed-cell':release.id==='add-release'?' add-column-lane':release.id==='backlog'?' backlog':''));cell.dataset.track=track.id;cell.dataset.release=release.id;if(isCollapsed(release.id)&&columnDefault(release.id))cell.dataset.defaultStatus=columnDefault(release.id);cell.style.gridColumn=grid[index].start+' / '+grid[index].end;cell.style.gridRow='1 / span '+(height+1);
   if(!isCollapsed(release.id)&&release.id!=='add-release'){const add=text('button','','add-card');add.type='button';add.innerHTML=toolIcon('plus');add.title='Создать карточку';add.setAttribute('aria-label','Создать карточку: '+track.title+' / '+release.title);add.onclick=()=>openTaskEditor(null,track.id,release.id);cell.append(add)}row.append(cell);
  }
  for(const item of placements){const card=createCard(item.task);card.boardSpan={start:item.start,end:item.end,lanes:!item.task.releaseEnd};card.boardPlacement={start:grid[item.start].start,end:grid[item.end].end,lanes:!item.task.releaseEnd};card.style.gridRow='1';row.append(card);visible++}
  const clear=()=>row.querySelectorAll('.over').forEach(cell=>cell.classList.remove('over'));
  row.ondragover=event=>{event.preventDefault();clear();const id=releaseAtX(event.clientX);if(id&&id!=='add-release'&&!isCollapsed(id)){event.dataTransfer.dropEffect='move';[...row.querySelectorAll('.row-cell')].find(cell=>cell.dataset.release===id)?.classList.add('over')}};
  row.ondragleave=event=>{if(!row.contains(event.relatedTarget))clear()};
  row.ondrop=event=>{event.preventDefault();clear();const id=event.dataTransfer.getData('text/plain'),release=releaseAtX(event.clientX);if(!release||release==='add-release'||isCollapsed(release)||!state.tasks.some(t=>t.id===id))return;selected=id;moveTask(id,track.id,release,event.target.closest('.card')?.dataset.id)};
  board.append(row);layoutTrackCards(row);for(const card of row.querySelectorAll(':scope > .card'))cardSizeObserver.observe(card);
 }
 const addTrackCell=text('div','','track add-track'),addTrack=text('button','','add-board-button');addTrack.type='button';addTrack.innerHTML=toolIcon('plus');addTrack.title='Добавить трек';addTrack.setAttribute('aria-label',addTrack.title);addTrack.onclick=()=>openTrack();addTrackCell.append(addTrack);board.append(addTrackCell);const tail=text('div','','add-track-tail');tail.style.gridColumn='2 / -1';board.append(tail);
 saveProjectView();$('counts').textContent=visible+' из '+state.tasks.length+' карточек';$('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;detail();refreshSelects();if(full!==false)window.roadmapCloud?.paint();
 // Replacing the board temporarily clamps scroll offsets to zero. Restore only
 // after the complete layout exists; the browser still clamps at real bounds.
 scroller.scrollTop=scrollTop;scroller.scrollLeft=scrollLeft;
 if(window.scrollX!==pageX||window.scrollY!==pageY)window.scrollTo({left:pageX,top:pageY,behavior:'instant'});
}
