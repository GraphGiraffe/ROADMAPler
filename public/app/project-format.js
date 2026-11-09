/* Portable project contract. No DOM, storage or provider dependencies. */
(function installProjectFormat() {
  'use strict';
  const labels = Object.freeze({
    done: 'Выполнено', idea: 'Идея', check: 'Нужно проверить', planned: 'Запланировано',
    work: 'В работе', blocked: 'Заблокировано', paused: 'На паузе'
  });
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const statusValid = value => typeof value === 'string' && Object.hasOwn(labels, value);

  const trackIcons = {"folder": {"title": "Проекты", "path": "M3 7h7l2 2h9v11H3z"}, "board": {"title": "Доска", "path": "M3 4h18v16H3zM9 4v16M15 4v16"}, "code": {"title": "Разработка", "path": "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"}, "tools": {"title": "Инструменты", "path": "m5 3 4 4-2 2-4-4v5l4 3 3-1 8 9 3-3-9-8 1-3-3-4z"}, "database": {"title": "Данные", "path": "M3 6c0-5 18-5 18 0s-18 5-18 0v12c0 5 18 5 18 0V6M3 12c0 5 18 5 18 0"}, "cloud": {"title": "Облако", "path": "M6 19a4 4 0 0 1 0-8 6 6 0 0 1 12-2 5 5 0 0 1 0 10Z"}, "network": {"title": "Сеть", "path": "M12 3v7M4 20v-6h16v6M12 14v6M9 3h6v5H9z"}, "shield": {"title": "Безопасность", "path": "m12 2 9 4v7c0 5-9 9-9 9S3 18 3 13V6zM8 12l3 3 5-6"}, "test": {"title": "Качество", "path": "m5 12 4 4L20 5M4 3h9M3 7h5M3 20h18"}, "bug": {"title": "Диагностика", "path": "M8 8h8v10H8zM10 8V4h4v4M3 10h5m8 0h5M3 16h5m8 0h5M5 4l3 4m8 0 3-4"}, "rocket": {"title": "Выпуск", "path": "M9 15 4 20l1-7 9-9 7-1-1 7-9 9zM13 7l4 4M4 20l4-1"}, "phone": {"title": "PWA и устройства", "path": "M6 2h12v20H6zM10 18h4"}, "layout": {"title": "Интерфейс", "path": "M3 3h18v18H3zM3 9h18M9 9v12"}, "palette": {"title": "Темы и дизайн", "path": "M12 3a9 9 0 1 0 0 18h2l-1-5h5c6-3 1-13-6-13zM7 8h.1M12 6h.1M17 9h.1M6 13h.1"}, "image": {"title": "Изображения", "path": "M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M15 7h.1"}, "sound": {"title": "Речь и звук", "path": "M3 9h5l5-5v16l-5-5H3zM17 8q6 4 0 8"}, "chat": {"title": "Общение", "path": "M3 4h18v13H9l-6 4zM7 8h10M7 12h7"}, "person": {"title": "Люди и аватары", "path": "M8 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0M3 22v-4c0-6 18-6 18 0v4"}, "game": {"title": "Игры", "path": "M6 7h12l4 12-5-2H7l-5 2zM6 11h6M9 8v6M16 11h.1M19 14h.1"}, "rules": {"title": "Правила", "path": "M4 3h16v18H4zM8 7h8M8 11h8M8 15h5"}, "book": {"title": "Документация", "path": "M12 5C9 2 3 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-2-7-2-10 1v15"}, "license": {"title": "Лицензии", "path": "M6 2h9l5 5v15H6zM15 2v6h5M10 12h6M10 16h4"}, "automation": {"title": "Автоматизация", "path": "M13 2 4 14h7l-1 8 10-13h-8z"}, "flask": {"title": "Эксперименты", "path": "M8 2h8M10 2v7L3 21h18L14 9V2M7 15h10"}, "chart": {"title": "Анализ и измерения", "path": "M3 3v18h18M6 16l5-7 4 4 6-9"}, "idea": {"title": "Идеи", "path": "M8 17c-8-8 0-20 8-12 5 5-1 12-1 12zM9 21h6"}, "calendar": {"title": "Планы", "path": "M3 5h18v16H3zM7 2v6M17 2v6M3 10h18"}, "checklist": {"title": "Задачи", "path": "M9 5h12M9 12h12M9 19h12M2 5l2 2 3-4M2 12l2 2 3-4M2 19l2 2 3-4"}, "home": {"title": "Дом и быт", "path": "m2 11 10-9 10 9M5 9v13h14V9M10 22v-7h4v7"}, "cook": {"title": "Готовка", "path": "M5 15a5 5 0 0 1 0-10 7 7 0 0 1 14 0 5 5 0 0 1 0 10v7H5zM5 18h14"}, "fitness": {"title": "Тренировки", "path": "M2 8v8M5 5v14M5 12h14M19 5v14M22 8v8"}, "heart": {"title": "Здоровье", "path": "M12 21 3 12C-2 4 8-2 12 6c4-8 14-2 9 6z"}, "plant": {"title": "Огород и растения", "path": "M12 22V10M12 15C2 15 2 5 2 5s10 0 10 10M12 10c0-8 10-8 10-8s0 10-10 8"}, "sun": {"title": "Сезон и погода", "path": "M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"}, "content": {"title": "Контент-план", "path": "M3 3h18v18H3zM6 7h12M6 11h12M6 15h5M15 14l4 3-4 3z"}, "video": {"title": "Видео", "path": "M2 5h14v14H2zM16 9l6-4v14l-6-4"}, "shopping": {"title": "Покупки", "path": "M2 3h3l3 12h11l3-9H6M9 20h.1M18 20h.1"}, "money": {"title": "Бюджет", "path": "M2 5h20v14H2zM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0M5 9h.1M19 15h.1"}, "travel": {"title": "Поездки", "path": "M3 3l6 3 6-3 6 3v15l-6-3-6 3-6-3zM9 6v15M15 3v15"}, "package": {"title": "Паки и материалы", "path": "m12 2 10 5v10l-10 5-10-5V7zM2 7l10 5 10-5M12 12v10"}, "timer": {"title": "Время", "path": "M8 2h8M12 2v4M4 14a8 8 0 1 0 16 0 8 8 0 1 0-16 0M12 9v5l3 2"}};

  function validateProject(value) {
    if (!record(value) || value.format !== 'roadmap-project' || ![1, 2].includes(value.formatVersion)) {
      throw Error('Нужен JSON проекта ROADMAPler версии 1 или 2.');
    }
    for (const field of ['tracks', 'releases', 'tasks', 'sources']) {
      if (!Array.isArray(value[field])) throw Error('Отсутствует список ' + field);
    }
    if (!record(value.project) || typeof value.project.name !== 'string') throw Error('Нет названия проекта.');
    if(value.project.color!==undefined&&(typeof value.project.color!=='string'||! /^(#[0-9a-fA-F]{6})?$/.test(value.project.color)))throw Error('Некорректный цвет проекта.');
    if (!value.tracks.length) throw Error('Проект должен содержать трек.');
    for (const field of ['tracks', 'releases', 'tasks']) {
      const ids = new Set();
      for (const item of value[field]) {
        if (!record(item) || typeof item.id !== 'string' || typeof item.title !== 'string') {
          throw Error('Некорректная сущность проекта: ' + field);
        }
        if (ids.has(item.id)) throw Error('Идентификаторы должны быть уникальны: ' + field);
        ids.add(item.id);
        if(field==='tracks'){
          if(item.icon!==undefined&&(typeof item.icon!=='string'||!/^([a-z][a-z0-9-]{0,39})?$/.test(item.icon)))throw Error('Некорректная иконка трека.');
          if(item.color!==undefined&&(typeof item.color!=='string'||! /^(#[0-9a-fA-F]{6})?$/.test(item.color)))throw Error('Некорректный цвет трека.');
        }
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

  const api = { labels, trackIcons, validateProject };
  Object.defineProperty(api, 'portableSource', { get: () => '(' + installProjectFormat.toString() + ')();' });
  globalThis.RoadmapProjectFormat = Object.freeze(api);
})();
