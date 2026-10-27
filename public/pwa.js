(() => {
  const byId = id => document.getElementById(id);
  if (!isSecureContext || !['http:', 'https:'].includes(location.protocol) || !('serviceWorker' in navigator)) return;
  let prompt = null, registration = null, applying = false, timer, lastCheck = 0, announcedUpdate = false;
  const mode = matchMedia('(display-mode: standalone)');
  const installed = () => mode.matches || navigator.standalone === true;
  const message = text => { byId('pwaPanel').hidden = false; byId('pwaMessage').textContent = text; };
  const refreshInstall = () => {
    byId('installApp').hidden = installed();
    byId('installApp').textContent = prompt ? 'Установить приложение' : 'Как установить приложение';
  };
  refreshInstall();
  mode.addEventListener('change', refreshInstall);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; refreshInstall(); });
  window.addEventListener('appinstalled', () => { prompt = null; refreshInstall(); message('Приложение установлено. Его можно открыть с главного экрана.'); });
  byId('installApp').onclick = async () => {
    if (!prompt) { message('В меню браузера выберите «Установить приложение» или «На главный экран». На iPhone/iPad: Safari → «Поделиться» → «На экран Домой».'); return; }
    const offer = prompt; prompt = null;
    try { await offer.prompt(); await offer.userChoice; } catch { message('Установку можно повторить из меню браузера.'); }
    refreshInstall();
  };
  const refreshWaiting = () => {
    if (registration?.waiting && navigator.serviceWorker.controller) {
      announcedUpdate = true;
      byId('applyUpdate').hidden = false;
      message('Доступно обновление. Примените его, когда закончите редактирование. Проекты и история отмены сохранятся.');
    } else if (announcedUpdate) {
      byId('applyUpdate').hidden = true; byId('pwaPanel').hidden = true; announcedUpdate = false;
    }
  };
  const watch = worker => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') {
        refreshWaiting();

      }
      if (worker.state === 'redundant') message('Не удалось загрузить обновление. Текущая версия продолжает работать.');
    });
  };
  const check = async (manual = false) => {
    if (!registration || applying || (!manual && Date.now() - lastCheck < 60000)) return;
    lastCheck = Date.now(); byId('checkUpdate').disabled = true;
    try {
      await registration.update();
      if (registration.waiting) refreshWaiting();
      else if (manual) message(registration.installing ? 'Обновление загружается…' : 'У вас актуальная версия приложения.');
    } catch { if (manual) message('Не удалось проверить обновления. Проверьте подключение к сети. Текущая версия доступна офлайн.'); }
    finally { byId('checkUpdate').disabled = false; }
  };
  byId('checkUpdate').onclick = () => check(true);
  byId('applyUpdate').onclick = () => {
    if (!registration?.waiting || applying) return;
    try {
      window.roadmapUpdate.prepare(); applying = true;
      document.querySelector('main').inert = true;
      message('Применяем обновление…');
      timer = setTimeout(() => {
        applying = false; document.querySelector('main').inert = false;
        window.roadmapUpdate.cancel();
        message('Обновление не ответило. Можно продолжить работу и повторить попытку.');
      }, 15000);
      registration.waiting.postMessage('ACTIVATE');
    } catch (error) { message(error.message || 'Не удалось сохранить состояние. Экспортируйте проект перед обновлением.'); }
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) { clearTimeout(timer); location.reload(); } else refreshWaiting();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(value => {
    registration = value; byId('checkUpdate').hidden = false;
    registration.addEventListener('updatefound', () => watch(registration.installing));
    watch(registration.installing); refreshWaiting();
    window.addEventListener('online', () => check());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }).catch(() => message('Офлайн-режим недоступен. Приложение продолжает работать; попробуйте открыть его через HTTPS.'));
})();
