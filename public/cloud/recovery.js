/* Password recovery is isolated from synchronization sessions and project storage. */
(() => {
 'use strict';
 window.RoadmapRecovery={init({settings,showAccount,getClient}){
  const $=id=>document.getElementById(id);
  document.querySelector('main').insertAdjacentHTML('beforeend',`<dialog id="recoveryDialog" data-cloud aria-labelledby="recoveryTitle"><h2 id="recoveryTitle">Восстановление пароля</h2><p id="recoveryState" role="status"></p><form id="recoveryRequest" novalidate><label>Почта<input id="recoveryEmail" type="email" autocomplete="username" required maxlength="254"></label><div class="actions"><button id="recoverySend" type="submit" class="primary">Отправить письмо</button></div></form><form id="recoveryPasswordForm" novalidate hidden><label>Новый пароль<input id="recoveryPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><label>Повторите пароль<input id="recoveryPasswordAgain" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><div class="actions"><button id="recoverySave" type="submit" class="primary">Сохранить пароль</button></div></form><p id="recoveryError" class="field-error" role="status"></p><div class="actions"><button id="recoveryLogin" type="button" hidden>К аккаунту</button><button id="recoveryClose" type="button">Закрыть</button></div></dialog>`);
  const forgot=document.createElement('button');forgot.type='button';forgot.id='cloudForgotPassword';forgot.textContent='Забыли пароль?';const change=document.createElement('button');change.type='button';change.id='cloudChangePassword';change.textContent='Сменить пароль';$('cloudSecurityActions').append(change,forgot);
  let epoch=0,recoveryClient=null,recoveryToken=null,sending=false,saving=false,flow='recovery';
  function provider(){const {supabaseUrl:url,supabaseKey:key}=settings();if(!url||!key)throw Error('Сервер не подключён.');return new window.RoadmapSync.Supabase({url,key})}
  function clear(){
   epoch++;const c=recoveryClient,token=recoveryToken;recoveryClient=null;recoveryToken=null;sending=false;saving=false;
   $('recoveryEmail').value='';$('recoveryPassword').value='';$('recoveryPasswordAgain').value='';$('recoverySend').disabled=false;$('recoverySave').disabled=false;$('recoveryClose').disabled=false;
   if(c&&token&&flow==='recovery')c.endRecovery(token).catch(()=>{});
  }
  function resetView(){clear();flow='recovery';$('recoveryTitle').textContent='Восстановление пароля';$('recoveryError').textContent='';$('recoveryState').textContent='';$('recoveryRequest').hidden=true;$('recoveryPasswordForm').hidden=true;$('recoveryLogin').hidden=true}
  function openRequest(){
   const email=getClient()?.config.user?.email||$('cloudEmail').value.trim();$('cloudAccount').close();resetView();$('recoveryRequest').hidden=false;$('recoveryEmail').value=email;$('recoveryState').textContent='Введите почту аккаунта ROADMAPler.';$('recoveryDialog').showModal();$('recoveryEmail').focus();
  }
  function refresh(){const current=getClient();change.hidden=!current;$('cloudSecurity').hidden=!current&&$('cloudProvider').value!=='supabase';forgot.textContent=current?'Восстановить пароль по почте':'Забыли пароль?'}
  window.RoadmapRecovery.refresh=refresh;refresh();
  forgot.onclick=openRequest;
  change.onclick=()=>{const current=getClient();if(!current)return;$('cloudAccount').close();resetView();flow='account';recoveryClient=current;$('recoveryTitle').textContent='Сменить пароль';$('recoveryState').textContent='Новый пароль для '+(current.config.user?.email||'текущего аккаунта');$('recoveryPasswordForm').hidden=false;$('recoveryDialog').showModal();$('recoveryPassword').focus()};
  $('recoveryClose').onclick=()=>{if(!saving)$('recoveryDialog').close()};
  $('recoveryDialog').addEventListener('cancel',event=>{if(saving)event.preventDefault()});
  $('recoveryDialog').addEventListener('close',clear);
  $('recoveryLogin').onclick=()=>{$('recoveryDialog').close();showAccount()};
  $('recoveryRequest').onsubmit=async event=>{
   event.preventDefault();if(sending)return;$('recoveryError').textContent='';const input=$('recoveryEmail'),email=input.value.trim();
   input.value=email;if(!email||!input.checkValidity()){$('recoveryError').textContent='Введите корректную почту.';input.focus();return}
   sending=true;$('recoverySend').disabled=true;const attempt=epoch;
   try{const redirect=new URL('.',location.href);redirect.searchParams.set('recovery','1');await provider().recover(email,redirect.href);if(attempt!==epoch)return;$('recoveryRequest').hidden=true;$('recoveryState').textContent='Если аккаунт с этой почтой существует, письмо со ссылкой для восстановления отправлено. Проверьте почту и папку «Спам».'}
   catch{if(attempt===epoch)$('recoveryError').textContent='Не удалось отправить письмо. Проверьте подключение и повторите позже.'}
   finally{if(attempt===epoch){sending=false;$('recoverySend').disabled=false}}
  };
  $('recoveryPasswordForm').onsubmit=async event=>{
   event.preventDefault();if(saving||!recoveryClient||(flow==='recovery'&&!recoveryToken))return;$('recoveryError').textContent='';const password=$('recoveryPassword').value;
   if(password.length<12||password.length>128){$('recoveryError').textContent='Пароль должен содержать от 12 до 128 символов.';$('recoveryPassword').focus();return}
   if(password!==$('recoveryPasswordAgain').value){$('recoveryError').textContent='Пароли не совпадают.';$('recoveryPasswordAgain').focus();return}
   saving=true;$('recoverySave').disabled=true;$('recoveryClose').disabled=true;const attempt=epoch,c=recoveryClient,kind=flow;let token=recoveryToken;
   try{if(kind==='account'){await c.refresh();if(getClient()!==c)throw Object.assign(Error('Подключение изменилось'),{status:401});token=c.config.token}await c.updatePassword(token,password);if(attempt!==epoch)return;$('recoveryPasswordForm').hidden=true;$('recoveryPassword').value='';$('recoveryPasswordAgain').value='';$('recoveryState').textContent='Пароль обновлён. Теперь можно войти в аккаунт с новым паролем.';$('recoveryLogin').hidden=false;recoveryClient=null;recoveryToken=null;if(kind==='recovery')c.endRecovery(token).catch(()=>{})}
   catch(error){if(attempt===epoch){$('recoveryPassword').value='';$('recoveryPasswordAgain').value='';if(error.status===401||error.status===403){recoveryClient=null;recoveryToken=null;$('recoveryPasswordForm').hidden=true;$('recoveryLogin').hidden=false;$('recoveryError').textContent=kind==='account'?'Войдите в аккаунт заново или восстановите пароль по почте.':'Ссылка недействительна или устарела. Запросите новое письмо.'}else $('recoveryError').textContent='Не удалось сохранить пароль. Повторите попытку; если соединение прервалось, пароль мог уже измениться.'}}
   finally{if(attempt===epoch){saving=false;$('recoverySave').disabled=false;$('recoveryClose').disabled=false}}
  };
  async function consumeLink(){
   const url=new URL(location.href),params=new URLSearchParams(url.hash.slice(1));
   if(params.get('type')!=='recovery'&&url.searchParams.get('recovery')!=='1')return;
   const token=params.get('access_token');
   // Clear both access and refresh tokens from the URL before making any requests.
   url.hash='';url.searchParams.delete('recovery');
   try{history.replaceState(history.state,'',url.pathname+url.search)}catch{return}
   resetView();$('recoveryDialog').showModal();$('recoveryState').textContent='Проверка ссылки…';const attempt=epoch;
   if(params.get('error')||params.get('type')!=='recovery'||!token||token.length>16384){$('recoveryState').textContent='';$('recoveryError').textContent='Ссылка недействительна или устарела. Запросите новое письмо.';$('recoveryLogin').hidden=false;return}
   try{
    recoveryClient=provider();recoveryToken=token;const user=await recoveryClient.recoveryUser(token);if(attempt!==epoch)return;
    if(!user?.id||typeof user.email!=='string')throw Error('Invalid recovery user');
    $('recoveryState').textContent='Новый пароль для '+user.email;$('recoveryPasswordForm').hidden=false;$('recoveryPassword').focus();
   }catch{if(attempt===epoch){const c=recoveryClient;recoveryClient=null;recoveryToken=null;if(c)c.endRecovery(token).catch(()=>{});$('recoveryState').textContent='';$('recoveryError').textContent='Не удалось проверить ссылку. Она могла устареть; проверьте подключение или запросите новое письмо.';$('recoveryLogin').hidden=false}}
  }
  consumeLink();
 }};
})();
