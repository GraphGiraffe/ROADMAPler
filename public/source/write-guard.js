'use strict';
// The only cross-context mutation authority. No DOM/model/storage access here.
// Callers still compare the saved vault bytes, catching stale or older clients.
function createVaultGuard({locks,key,portable=false}){
 let owned=portable,pending=false,stopped=false,epoch=0,controller=null,releaseHold=null,mode=portable?'owner':'waiting';
 const listeners=new Set(),emit=()=>{for(const listener of listeners)listener(mode)};
 function start(){
  if(portable||owned||pending)return;stopped=false;
  if(!locks?.request){mode='unsupported';emit();return}
  pending=true;mode='waiting';const attempt=++epoch;controller=new AbortController();emit();
  locks.request(key,{mode:'exclusive',signal:controller.signal},async()=>{
   if(stopped||attempt!==epoch)return;
   owned=true;mode='owner';emit();
   await new Promise(resolve=>{releaseHold=resolve});
  }).catch(error=>{if(attempt===epoch&&error.name!=='AbortError'){mode='unsupported';emit()}}).finally(()=>{if(attempt===epoch)pending=false});
 }
 function release(){
  if(portable)return;stopped=true;epoch++;controller?.abort();releaseHold?.();releaseHold=null;owned=false;pending=false;mode='waiting';emit();
 }
 const api={canWrite:()=>owned,mode:()=>mode,start,release,onChange(listener){listeners.add(listener);listener(mode);return()=>listeners.delete(listener)},requireWrite(){if(!owned)throw Error(mode==='unsupported'?'Для сохранения нужен браузер с Web Locks в безопасном контексте HTTPS. Проекты можно экспортировать.':'В другой вкладке открыт этот ROADMAPler. Закройте её, затем повторите сохранение.')}};
 start();return api;
}
