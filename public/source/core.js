'use strict';
const portable=document.documentElement.dataset.portable==='true'||location.protocol==='file:';
let searchTimer=null;
const $=id=>document.getElementById(id),clone=v=>JSON.parse(JSON.stringify(v));
let state=JSON.parse($('roadmapData').textContent),selected=state.tasks.find(t=>t.release==='backlog')?.id||state.tasks[0]?.id,editingRelease=null;
let showBacklog=document.documentElement.dataset.backlog!=='hidden';
const hiddenTracks=new Set(),hiddenReleases=new Set();
const undoStack=[],redoStack=[],labels=RoadmapProjectFormat.labels;
function option(select,value,title){const o=document.createElement('option');o.value=value;o.textContent=title;select.append(o)}
function text(tag,value,className){const n=document.createElement(tag);n.textContent=value;if(className)n.className=className;return n}
function selectedTask(){return state.tasks.find(t=>t.id===selected)}

function completedRelease(id){return columnDefault(id)==='done'&&state.tasks.filter(task=>taskReleases(task).includes(id)).every(task=>task.status==='done')}
function isCollapsed(id){return id==='backlog'?!showBacklog:hiddenReleases.has(id)}
function toggleRelease(id){if(id==='backlog'){showBacklog=!showBacklog;document.documentElement.dataset.backlog=showBacklog?'visible':'hidden'}else if(hiddenReleases.has(id))hiddenReleases.delete(id);else hiddenReleases.add(id);draw()}

function statusMark(status){
 const paths={'':'<path d="M5 12h14m-4-4 4 4-4 4"/>',done:'<path d="m5 12 4 4L19 6"/>',planned:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6M9 16h4"/>',idea:'<path d="M9 18h6m-5 3h4M8 14a7 7 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4Z"/>',check:'<path d="M10.3 4a2 2 0 0 1 3.4 0L22 18a2 2 0 0 1-1.7 3H3.7A2 2 0 0 1 2 18Z"/><path d="M12 9v5M12 17v.2"/>',work:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',blocked:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',paused:'<circle cx="12" cy="12" r="9"/><path d="M9 8v8m6-8v8"/>'};
 const mark=text('span','','status-mark');mark.setAttribute('aria-hidden','true');mark.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+(paths[status]||paths.idea)+'</svg>';return mark;
}

function visibilityButton(show,label,handler){const button=text('button','','visibility-button');button.type='button';button.title=label;button.setAttribute('aria-label',label);button.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'+(show?'':'<path d="m3 3 18 18"/>')+'</svg>';button.onclick=handler;return button}

function columns(){return [...state.releases,{id:'backlog',title:'Backlog',note:'Без назначенного релиза'}]}
function historyEntry(withOrder=false){return JSON.stringify(withOrder?{format:'roadmap-command',formatVersion:1,data:state,projectOrder:vault.projects.map(project=>project.id)}:state)}
function readHistory(raw){const entry=JSON.parse(raw);if(entry?.format!=='roadmap-command')return {data:validateProject(entry),projectOrder:null};if(entry.formatVersion!==1||!Array.isArray(entry.projectOrder)||entry.projectOrder.some(id=>typeof id!=='string')||new Set(entry.projectOrder).size!==entry.projectOrder.length)throw Error('Некорректная история порядка проектов.');return {data:validateProject(entry.data),projectOrder:entry.projectOrder}}
function change(fn,message='Изменения сохранены в этом браузере.',projectOrder=null){
 const before=historyEntry(projectOrder!==null),previous=JSON.stringify(state);fn();if(previous===JSON.stringify(state)&&(projectOrder===null||JSON.stringify(projectOrder)===JSON.stringify(vault.projects.map(project=>project.id))))return true;
 try{persistProject(vault.active,projectOrder);RoadmapHistory.record(undoStack,redoStack,before);draw();$('statusMessage').textContent=message;return true}
 catch(error){state=JSON.parse(previous);draw();$('statusMessage').textContent='Изменение не сохранено: '+error.message+' Можно экспортировать текущий проект.';return false}
}
function restore(from,to){if(!from.length)return;let before;try{const target=readHistory(from.at(-1));before=historyEntry(target.projectOrder!==null);state=target.data;persistProject(vault.active,target.projectOrder);from.pop();to.push(before);RoadmapHistory.trim(undoStack,redoStack,to===redoStack?'redo':'undo');draw();$('statusMessage').textContent='Изменение сохранено. Доступны отмена и повтор.'}catch(error){if(before)state=readHistory(before).data;draw();$('statusMessage').textContent=error.message}}
