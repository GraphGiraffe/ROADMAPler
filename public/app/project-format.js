/* Portable project contract. No DOM, storage or provider dependencies. */
(function installProjectFormat() {
  'use strict';
  const labels = Object.freeze({
    done: 'Выполнено', idea: 'Идея', check: 'Нужно проверить', planned: 'Запланировано',
    work: 'В работе', blocked: 'Заблокировано', paused: 'На паузе'
  });
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const statusValid = value => typeof value === 'string' && Object.hasOwn(labels, value);

  function validateProject(value) {
    if (!record(value) || value.format !== 'roadmap-project' || ![1, 2].includes(value.formatVersion)) {
      throw Error('Нужен JSON проекта ROADMAPler версии 1 или 2.');
    }
    for (const field of ['tracks', 'releases', 'tasks', 'sources']) {
      if (!Array.isArray(value[field])) throw Error('Отсутствует список ' + field);
    }
    if (!record(value.project) || typeof value.project.name !== 'string') throw Error('Нет названия проекта.');
    if (!value.tracks.length) throw Error('Проект должен содержать трек.');
    for (const field of ['tracks', 'releases', 'tasks']) {
      const ids = new Set();
      for (const item of value[field]) {
        if (!record(item) || typeof item.id !== 'string' || typeof item.title !== 'string') {
          throw Error('Некорректная сущность проекта: ' + field);
        }
        if (ids.has(item.id)) throw Error('Идентификаторы должны быть уникальны: ' + field);
        ids.add(item.id);
        if (field === 'releases' && ['backlog', 'add-release'].includes(item.id)) {
          throw Error('Зарезервированный идентификатор релиза.');
        }
      }
    }
    for (const status of [value.backlogDefaultStatus, ...value.releases.map(item => item.defaultStatus)]) {
      if (status !== undefined && status !== '' && (value.formatVersion < 2 || !statusValid(status))) {
        throw Error('Некорректный статус колонки или версия формата.');
      }
    }
    const tracks = new Set(value.tracks.map(item => item.id));
    const releases = new Set(['backlog', ...value.releases.map(item => item.id)]);
    for (const task of value.tasks) {
      if (!tracks.has(task.track) || !releases.has(task.release) || typeof task.description !== 'string' || !statusValid(task.status)) {
        throw Error('Некорректная карточка проекта.');
      }
      if (task.releaseEnd !== undefined) {
        const start = value.releases.findIndex(item => item.id === task.release);
        const end = value.releases.findIndex(item => item.id === task.releaseEnd);
        if (value.formatVersion < 2 || start < 0 || end < start) throw Error('Некорректный диапазон релизов карточки.');
      }
    }
    return value;
  }

  const api = { labels, validateProject };
  Object.defineProperty(api, 'portableSource', { get: () => '(' + installProjectFormat.toString() + ')();' });
  globalThis.RoadmapProjectFormat = Object.freeze(api);
})();
