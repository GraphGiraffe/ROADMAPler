/* Project-scoped capability management. Full secrets never enter browser storage. */
(() => {
 window.RoadmapIntegrations={init({app,getClient,getGeneration,showAccount}){
  const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
  let secret=null,secretClient=null,revoking=null,loading=false,requestGeneration=0;
  const dialogMarkup=`<dialog id="integrationsDialog" data-cloud aria-labelledby="integrationsTitle"><h2 id="integrationsTitle">Интеграции</h2><p class="note">Токены дают приложениям доступ к одному облачному проекту ROADMAPler. Пароль аккаунта передавать не нужно.</p><p id="integrationsState" role="status"></p><button id="integrationsLogin" type="button" hidden>Подключить аккаунт</button>
  <form id="integrationForm" novalidate><label>Проект<select id="integrationProject"></select></label><label>Название<input id="integrationName" maxlength="100" placeholder="Помощник для проекта" autocomplete="off"></label><div class="integration-permissions"><label class="check-label"><input id="integrationRead" type="checkbox" checked> Чтение</label><label class="check-label"><input id="integrationWrite" type="checkbox"> Изменение</label><label class="check-label"><input id="integrationDelete" type="checkbox"> Удаление проекта</label></div><label>Срок действия<select id="integrationDays"><option value="7">7 дней</option><option value="30" selected>30 дней</option><option value="90">90 дней</option><option value="365">1 год</option></select></label><div class="actions"><button type="submit" id="integrationCreate" class="primary">Создать токен</button></div></form><p id="integrationError" class="field-error" role="status"></p><div id="integrationTokens"></div><div class="actions"><button id="integrationsRefresh" type="button">Обновить список</button><button id="integrationsClose" type="button">Закрыть</button></div></dialog>
  <dialog id="integrationSecretDialog" data-cloud aria-labelledby="integrationSecretTitle"><h2 id="integrationSecretTitle">Сохраните токен</h2><p>Секрет показывается только сейчас. После закрытия получить его повторно нельзя; при потере создайте новый токен.</p><label>Токен<input id="integrationSecret" readonly autocomplete="off" spellcheck="false"></label><p id="integrationSecretProject" class="note"></p><p class="note">Файл подключения храните вне репозитория: <code>~/.config/roadmapler/credentials.json</code>, права <code>600</code>. Не отправляйте токен в чат.</p><p id="integrationSecretError" class="field-error" role="status"></p><div class="actions"><button id="integrationCopy" type="button">Копировать токен</button><button id="integrationDownload" type="button">Скачать подключение</button><button id="integrationSecretClose" type="button" class="primary">Закрыть</button></div></dialog>
  <dialog id="integrationRevokeDialog" data-cloud aria-labelledby="integrationRevokeTitle"><h2 id="integrationRevokeTitle">Отозвать токен?</h2><p id="integrationRevokeInfo"></p><p id="integrationRevokeError" class="field-error" role="status"></p><div class="actions"><button id="integrationRevokeCancel" type="button">Отмена</button><button id="integrationRevokeConfirm" type="button" class="danger">Отозвать</button></div></dialog>`;
  document.querySelector('main').insertAdjacentHTML('beforeend',dialogMarkup);
  const menu=node('button','Интеграции');menu.type='button';menu.dataset.cloud='';document.querySelector('.menu-panel').prepend(menu);
  const date=value=>value?new Date(value).toLocaleString('ru-RU'):'ещё не использован';
  const connection=()=>{const client=getClient();return client?{client,generation:getGeneration()}:null};
  const sameConnection=c=>c&&getClient()===c.client&&getGeneration()===c.generation;
  const api=async(c,name,body={})=>{
   if(!sameConnection(c))throw Error('Подключение изменилось. Откройте раздел заново.');
   try{return await c.client.api('rpc/'+name,{method:'POST',body:JSON.stringify(body)})}
   catch(error){if(error.status===404)throw Error('Раздел интеграций ещё не подключён на сервере. Обратитесь к владельцу приложения.');throw error}
  };
  function clearSecret(){secret=null;secretClient=null;$('integrationSecret').value='';$('integrationSecretProject').textContent='';$('integrationSecretError').textContent=''}
  $('integrationSecretDialog').addEventListener('close',clearSecret);
  $('integrationSecretDialog').addEventListener('cancel',clearSecret);
  $('integrationSecretClose').onclick=()=>{clearSecret();$('integrationSecretDialog').close()};
  $('integrationsClose').onclick=()=>$('integrationsDialog').close();
  $('integrationsDialog').addEventListener('close',()=>{requestGeneration++;loading=false;$('integrationName').value='';$('integrationError').textContent=''});
  $('integrationsLogin').onclick=()=>{$('integrationsDialog').close();showAccount()};
  function projects(c){return app.getVault().projects.filter(p=>p.cloud?.enabled&&p.cloud.provider==='supabase'&&p.cloud.owner===c.client.owner&&p.cloud.revision!=null)}
  function projectName(id){const p=app.getVault().projects.find(p=>p.cloud?.id===id&&p.cloud.owner===getClient()?.owner);return p?.data.project.name||id}
  async function refresh(){
   if(loading)return;const c=connection(),request=++requestGeneration;$('integrationError').textContent='';$('integrationTokens').replaceChildren();$('integrationProject').replaceChildren();$('integrationForm').hidden=!c;$('integrationsLogin').hidden=!!c;
   if(!c){$('integrationsState').textContent='Войдите в обычный аккаунт ROADMAPler. Токены этого раздела не относятся к личному GitHub.';return}
   loading=true;$('integrationsRefresh').disabled=true;$('integrationCreate').disabled=true;$('integrationsState').textContent='Загрузка…';
   try{
    for(const p of projects(c)){const option=node('option',p.data.project.name+' · '+p.cloud.id.slice(0,8));option.value=p.cloud.id;$('integrationProject').append(option)}
    const current=app.getVault().projects.find(p=>p.id===app.getVault().active);if(current?.cloud)$('integrationProject').value=current.cloud.id;if(!$('integrationProject').value&&$('integrationProject').options.length)$('integrationProject').selectedIndex=0;app.refreshSelects();
    const rows=await api(c,'roadmap_integration_list');if(!sameConnection(c)||request!==requestGeneration||!$('integrationsDialog').open)return;
    $('integrationsState').textContent=projects(c).length?'Выберите проект и права для нового токена.':'Для создания токена сначала включите облачный режим проекта и дождитесь синхронизации.';
    $('integrationCreate').disabled=!projects(c).length;
    for(const token of rows){
     const item=node('div',undefined,'integration-token');item.append(node('strong',token.name),node('small',projectName(token.project_id)+' · '+token.prefix+'…'));
     const permissions=[token.can_read?'чтение':'',token.can_write?'изменение':'',token.can_delete?'удаление':''].filter(Boolean).join(', ');item.append(node('small',permissions));
     const state=token.revoked_at?'Отозван · '+date(token.revoked_at):new Date(token.expires_at)<=new Date()?'Срок истёк':'Действует до '+date(token.expires_at);item.append(node('small',state),node('small','Последний успешный запрос: '+date(token.last_used_at)));
     if(!token.revoked_at){const revoke=node('button','Отозвать');revoke.type='button';revoke.className='danger';revoke.onclick=()=>{revoking={...c,id:token.id};$('integrationRevokeInfo').textContent='Приложение «'+token.name+'» потеряет доступ к проекту «'+projectName(token.project_id)+'».';$('integrationRevokeError').textContent='';$('integrationRevokeDialog').showModal();$('integrationRevokeCancel').focus()};item.append(revoke)}$('integrationTokens').append(item);
    }
    if(!rows.length)$('integrationTokens').append(node('p','Токенов пока нет.','note'));
   }catch(error){$('integrationError').textContent=error.message;$('integrationsState').textContent='Не удалось получить список токенов.'}
   finally{if(request===requestGeneration){loading=false;$('integrationsRefresh').disabled=false}}
  }
  menu.onclick=()=>{$('integrationsDialog').showModal();refresh()};$('integrationsRefresh').onclick=refresh;
  $('integrationForm').onsubmit=async event=>{
   event.preventDefault();if(loading)return;const c=connection(),generation=requestGeneration,name=$('integrationName').value.trim(),id=$('integrationProject').value;
   $('integrationError').textContent='';if(!c||!projects(c).some(p=>p.cloud.id===id)){ $('integrationError').textContent='Выберите синхронизированный облачный проект.';return}
   if(!name||![$('integrationRead'),$('integrationWrite'),$('integrationDelete')].some(x=>x.checked)){ $('integrationError').textContent='Укажите название и хотя бы одно разрешение.';return}
   const days=Number($('integrationDays').value);if(![7,30,90,365].includes(days))return;
   $('integrationCreate').disabled=true;loading=true;
   try{
    const rows=await api(c,'roadmap_integration_create',{p_project_id:id,p_name:name,p_expires_at:new Date(Date.now()+days*86400000).toISOString(),p_read:$('integrationRead').checked,p_write:$('integrationWrite').checked,p_delete:$('integrationDelete').checked});const created=Array.isArray(rows)?rows[0]:rows;
    if(!created?.secret_token||!/^rmi_[a-f0-9]{64}$/.test(created.secret_token))throw Error('Сервер не вернул секрет нового токена. Обновите список и отзовите неиспользуемый токен.');
    if(!sameConnection(c)||generation!==requestGeneration||!$('integrationsDialog').open){try{await api(c,'roadmap_integration_revoke',{p_token_id:created.id})}catch{}return}
    secret={supabaseUrl:c.client.url,publishableKey:c.client.config.key,token:created.secret_token,projectId:id};secretClient=c;$('integrationSecret').value=secret.token;$('integrationSecretProject').textContent='Проект: '+projectName(id)+' · '+id;$('integrationSecretError').textContent='';$('integrationSecretDialog').showModal();$('integrationName').value='';
   }catch(error){$('integrationError').textContent=error.message}
   finally{if(generation===requestGeneration){loading=false;$('integrationCreate').disabled=false;if($('integrationsDialog').open&&sameConnection(c))refresh()}}
  };
  $('integrationCopy').onclick=async()=>{if(!secret||!sameConnection(secretClient)){clearSecret();return}try{await navigator.clipboard.writeText(secret.token);$('integrationSecretError').textContent='Токен скопирован.'}catch{$('integrationSecretError').textContent='Выделите токен и скопируйте вручную.'}};
  $('integrationDownload').onclick=()=>{if(!secret||!sameConnection(secretClient)){clearSecret();return}const url=URL.createObjectURL(new Blob([JSON.stringify(secret,null,2)+'\n'],{type:'application/json'})),link=node('a');link.href=url;link.download='ROADMAPler-credentials.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  $('integrationRevokeCancel').onclick=()=>$('integrationRevokeDialog').close();$('integrationRevokeDialog').addEventListener('close',()=>{revoking=null});
  $('integrationRevokeConfirm').onclick=async()=>{if(!revoking)return;$('integrationRevokeConfirm').disabled=true;try{await api(revoking,'roadmap_integration_revoke',{p_token_id:revoking.id});$('integrationRevokeDialog').close();refresh()}catch(error){$('integrationRevokeError').textContent=error.message}finally{$('integrationRevokeConfirm').disabled=false}};
 }};
})();
