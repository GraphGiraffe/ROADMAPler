function showFieldError(input,message){const label=input.closest('label');let error=label.querySelector('.field-error');if(!error){error=text('small','','field-error');error.setAttribute('role','alert');label.append(error)}error.textContent=message;input.setAttribute('aria-invalid','true');input.focus()}
document.addEventListener('input',event=>{event.target.closest('label')?.querySelector('.field-error')?.remove();event.target.removeAttribute('aria-invalid')});

function toolIcon(name){const paths={save:'<path d="M5 3h12l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/>',edit:'<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>',plus:'<path d="M12 5v14M5 12h14"/>',undo:'<path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 6 8"/>',redo:'<path d="m16 5 5 5-5 5m5-5H11a6 6 0 0 0-6 8"/>',moon:'<path d="M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'};return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.plus)+'</svg>'}
const selectWidgets=new Map();let openSelect=null;
function closeSelectMenu(){if(!openSelect)return;openSelect.menu.remove();openSelect.trigger.setAttribute('aria-expanded','false');openSelect.trigger.removeAttribute('aria-activedescendant');openSelect=null}
function refreshSelects(){
 for(const select of document.querySelectorAll('select')){
  let widget=selectWidgets.get(select);
  if(!widget){
   const label=select.closest('label');const labelCopy=label?.cloneNode(true);labelCopy?.querySelectorAll('select,button').forEach(n=>n.remove());
   const wrapper=document.createElement('span');wrapper.className='select-control';select.before(wrapper);wrapper.append(select);select.hidden=true;
   const trigger=text('button','','select-trigger');trigger.type='button';trigger.id=select.id+'-trigger';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',select.id+'-options');trigger.setAttribute('aria-label',select.getAttribute('aria-label')||labelCopy?.textContent.trim()||'Выбор');wrapper.append(trigger);
   widget={select,trigger,menu:null,index:0};selectWidgets.set(select,widget);
   trigger.onclick=()=>openSelect===widget?closeSelectMenu():openSelectMenu(widget);
   trigger.onkeydown=event=>{
    if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){
     event.preventDefault();if(openSelect!==widget){openSelectMenu(widget);return}
     const options=[...widget.menu.children];if(event.key==='Enter'||event.key===' '){options[widget.index]?.click();return}
     widget.index=event.key==='Home'?0:event.key==='End'?options.length-1:(widget.index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;highlightSelect(widget);
    }else if(event.key==='Escape'&&openSelect===widget){event.preventDefault();event.stopPropagation();closeSelectMenu()}else if(event.key==='Tab')closeSelectMenu();
   };
   new MutationObserver(()=>syncSelect(widget)).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
   select.addEventListener('change',()=>syncSelect(widget));
  }
  syncSelect(widget);
 }
}
function syncSelect(widget){const {select,trigger}=widget;trigger.replaceChildren();const option=select.selectedOptions[0];if(select.dataset.statusOptions==='true'){const mark=statusMark(select.value);mark.className='status-icon';trigger.append(mark);trigger.dataset.status=select.value}trigger.append(text('span',option?.textContent||'Выберите'));trigger.insertAdjacentHTML('beforeend','<svg class="select-chevron" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>');trigger.disabled=select.disabled;}
function highlightSelect(widget){for(const [i,item] of [...widget.menu.children].entries())item.classList.toggle('highlighted',i===widget.index);const item=widget.menu.children[widget.index];if(item){widget.trigger.setAttribute('aria-activedescendant',item.id);item.scrollIntoView({block:'nearest'})}}
function openSelectMenu(widget){
 closeSelectMenu();if(widget.select.disabled)return;const menu=text('div','','select-menu');menu.id=widget.select.id+'-options';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',widget.trigger.getAttribute('aria-label'));widget.menu=menu;openSelect=widget;
 const options=[...widget.select.options];widget.index=Math.max(0,options.findIndex(o=>o.selected));
 for(const [i,option] of options.entries()){
  const item=text('div','','select-option');item.id=widget.select.id+'-option-'+i;item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));
  if(widget.select.dataset.statusOptions==='true'){item.classList.add('status-choice');if(option.value)item.classList.add(option.value);const mark=statusMark(option.value);mark.className='status-icon';item.append(mark)}
  item.append(text('span',option.textContent));item.onpointerdown=event=>event.preventDefault();item.onclick=()=>{widget.select.value=option.value;closeSelectMenu();syncSelect(widget);widget.select.dispatchEvent(new Event('change',{bubbles:true}));widget.trigger.focus({preventScroll:true})};menu.append(item);
 }
 (widget.select.closest('dialog')||document.body).append(menu);widget.trigger.setAttribute('aria-expanded','true');
 const rect=widget.trigger.getBoundingClientRect(),width=Math.min(Math.max(rect.width,190),innerWidth-24);menu.style.width=width+'px';menu.style.left=Math.max(12,Math.min(rect.left,innerWidth-width-12))+'px';const height=Math.min(320,menu.scrollHeight,innerHeight-32),below=innerHeight-rect.bottom-12;menu.style.maxHeight=Math.min(height,Math.max(below,rect.top-12))+'px';menu.style.top=(below>=height?rect.bottom+6:Math.max(12,rect.top-height-6))+'px';highlightSelect(widget);
}
document.addEventListener('pointerdown',event=>{if(openSelect&&!openSelect.trigger.contains(event.target)&&!openSelect.menu.contains(event.target))closeSelectMenu()});
window.addEventListener('resize',closeSelectMenu);document.addEventListener('scroll',event=>{if(openSelect&&!openSelect.menu.contains(event.target))closeSelectMenu()},true);
