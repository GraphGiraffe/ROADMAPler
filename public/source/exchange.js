const themeKey='roadmap-theme';
function setTheme(theme){document.documentElement.dataset.theme=theme;const themeColor=document.querySelector('meta[name="theme-color"]');if(themeColor)themeColor.content=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();$('themeToggle').innerHTML=toolIcon(theme==='dark'?'sun':'moon');$('themeToggle').title=theme==='dark'?'Включить светлую тему':'Включить тёмную тему';$('themeToggle').setAttribute('aria-label',theme==='dark'?'Включить светлую тему':'Включить тёмную тему');$('themeToggle').setAttribute('aria-pressed',String(theme==='dark'))}
let savedTheme;try{savedTheme=localStorage.getItem(themeKey)}catch{}
setTheme(['light','dark'].includes(savedTheme)?savedTheme:document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
$('themeToggle').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';setTheme(theme);try{localStorage.setItem(themeKey,theme)}catch{}};
function validateProject(value){return RoadmapProjectFormat.validateProject(value)}
$('exportProject').onclick=()=>{const exported=clone(state);exported.project.updatedAt=new Date().toISOString();const blob=new Blob([JSON.stringify(exported,null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='project.roadmap.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)};
$('importProject').onclick=()=>$('projectFile').click();let importPending=false,pendingImport=null;
$('projectFile').onchange=async()=>{const file=$('projectFile').files[0];if(!file)return;importPending=true;try{
 pendingImport=validateProject(JSON.parse(await file.text()));
 const name=pendingImport.project.name.trim(),matches=vault.projects.filter(p=>p.data.project.name.trim()===name);
 $('importMessage').textContent=matches.length?'Проект «'+name+'» уже есть. Обновить его содержимое из файла или создать отдельный проект? Обновление можно отменить.':'Создать проект «'+name+'» из файла?';
 $('importTarget').replaceChildren();for(const [index,p] of matches.entries())option($('importTarget'),p.id,p.data.project.name+(matches.length>1?' · '+(index+1):''));
 $('importTargetField').hidden=matches.length<2;$('updateImported').hidden=!matches.length;$('createImported').classList.toggle('primary',!matches.length);$('importError').textContent='';refreshSelects();$('importDialog').showModal();$('cancelImport').focus();
 }catch(e){pendingImport=null;$('statusMessage').textContent='Импорт не выполнен: '+e.message}finally{importPending=false;$('projectFile').value=''}};
$('cancelImport').onclick=()=>$('importDialog').close();$('importDialog').addEventListener('close',()=>{pendingImport=null;closeSelectMenu()});
$('createImported').onclick=()=>commitImport(false);$('updateImported').onclick=()=>commitImport(true);
function commitImport(update){
 if(!pendingImport)return;
 try{
  const target=update?vault.projects.find(p=>p.id===$('importTarget').value):null;if(update&&!target)throw Error('Выберите проект для обновления.');
  const id=target?.id||'project-'+crypto.randomUUID(),data=clone(pendingImport);data.project.id=target?.data.project.id||id;
  rememberProject();const projects=vault.projects.map(p=>p.id===vault.active?{...p,data:clone(state)}:p),before=projects.find(p=>p.id===id);
  const next=before?projects.map(p=>p.id===id?{...p,data}:p):[...projects,{id,data}];
  writeVault({...vault,active:id,projects:next});
  const previous=projectSessions.get(id),session={undo:[...(previous?.undo||[])],redo:[]};if(before)RoadmapHistory.record(session.undo,session.redo,JSON.stringify(before.data));else session.undo=[];projectSessions.set(id,session);
  $('importDialog').close();activateProject();$('statusMessage').textContent=update?'Проект обновлён из файла. Доступна отмена.':'Проект создан из файла.';
 }catch(error){$('importError').textContent=error.message}
}
$('aboutApp').onclick=()=>$('aboutDialog').showModal();$('aboutClose').onclick=()=>$('aboutDialog').close();
$('print').onclick=()=>window.print();
$('save').onclick=()=>{const html=document.documentElement.cloneNode(true);html.dataset.portable='true';const formatScript=html.querySelector('[data-project-format]');formatScript.removeAttribute('src');formatScript.textContent=RoadmapProjectFormat.portableSource;const historyScript=html.querySelector('[data-history]');historyScript.removeAttribute('src');historyScript.textContent=RoadmapHistory.portableSource;html.querySelectorAll('.select-control').forEach(wrapper=>{const select=wrapper.querySelector('select');select.hidden=false;wrapper.replaceWith(select)});html.querySelectorAll('.select-menu').forEach(menu=>menu.remove());html.querySelectorAll('[data-pwa],[data-cloud],[data-live-only]').forEach(n=>n.remove());html.querySelector('.project-menu').removeAttribute('open');html.querySelector('#roadmapData').textContent=JSON.stringify(state).replace(/</g,'\\u003c');html.querySelector('#board').replaceChildren();for(const id of ['filter'])html.querySelector('#'+id).replaceChildren();option(html.querySelector('#filter'),'all','Все треки');html.querySelector('#search').setAttribute('value','');html.querySelector('#showDone').setAttribute('checked','');html.querySelector('#showDoneReleases').toggleAttribute('checked',$('showDoneReleases').checked);html.querySelectorAll('dialog').forEach(d=>d.removeAttribute('open'));html.querySelector('#statusMessage').textContent='Сохранённая расстановка загружена. Можно продолжить редактирование.';const blob=new Blob(['<!doctype html>\n'+html.outerHTML],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='roadmapler-project.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);$('statusMessage').textContent='HTML подготовлен к скачиванию: релизы, карточки и порядок сохранены.'};
