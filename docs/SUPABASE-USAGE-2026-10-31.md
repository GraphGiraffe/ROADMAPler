# Расход Supabase · 31.10.2026

Проект klsxfhettffjbnmuxivg. Небольшие агрегаты за последние 24 часа сняты около 30.10.2026 17:54 UTC. Полные журналы, проекты и токены не выгружались. Поздняя повторная проверка MCP после рестарта зависла и остановлена: ниже результаты первоначального успешного доступа.

Источники событий: edge_logs 11233, postgres_logs 95, pgbouncer_logs 90, auth_logs 58, auth_audit_logs 54, realtime_logs 6, storage_logs 6. Главные запросы: GET /rest/v1/roadmap_projects 5551 и OPTIONS того же пути 5551. По select: 5524 GET списка ревизий, 27 полных чтений (агрегат включал также OPTIONS). По Referer 5550 GET пришли с graphgiraffe.github.io; скользящие окна выборок слегка различаются. Ведущего тестового источника не обнаружено; в public нет тестовых страниц. Браузерные тесты перехватывают Supabase.

Postgres: log_statement=ddl, log_duration=off, log_min_duration_statement=-1, log_connections/log_disconnections=off, log_min_messages=warning, pgaudit.log=none, pgaudit.log_parameter=off. Системные ролевые переопределения отключают log_statement. Подробных прикладных debug-логов в public/server нет; console.log сборки не отправляется в Supabase. Настройки управляемых Auth/API через MCP не менялись.

Два OPTIONS-запроса без данных подтвердили Access-Control-Max-Age:3600 и разрешение Cache-Control. Локальный Chromium подтвердил: fetch cache:no-store и cache:no-cache дают 3 GET + 3 OPTIONS; cache:default с явным Cache-Control:no-cache даёт 3 GET + 1 OPTIONS даже при cacheable-ответе. Простой cache:default даёт устаревший ответ и потому не используется самостоятельно.

Исправлено только Data API Supabase GET: cache:default плюс явный Cache-Control:no-cache,no-store. Ответы перепроверяются, разрешение CORS переиспользуется. Auth/GitHub и POST сохраняют прежний режим. У списка удалён неиспользуемый updated_at; чтение снимка выбирает id/revision/deleted/data без owner/updated_at, содержимое data сохраняется полностью.

Опрос каждые 15 секунд, один владелец записи, пауза скрытой вкладки, debounce, общий refresh Promise, backoff и проверки ревизий сохранены. Оптимизация дополнительных чтений снимков отложена: их всего 27 в выборке, дальнейшая правка затронула бы механизм синхронизации.

Локальная CORS-регрессия: шесть GET получают шесть новых ревизий, смена bearer-токена доходит до сервера, OPTIONS один. Ответ намеренно объявлен cacheable. Другие сценарии проверяют конфликты, аккаунт, импорт и офлайн-PWA. Нагрузочных тестов рабочего проекта не было.

Ожидается устранение большинства повторных OPTIONS в пределах срока CORS-кеша и небольшое уменьшение ответов. При прежней структуре трафика возможно убрать почти половину HTTP-событий опроса; это не измеренная экономия Logs Ingest в байтах. Производственная экономия Egress/Logs Ingest ещё не измерена. Накопленный расход не уменьшается задним числом. Старые вкладки продолжают старый код до обновления.

SQL-изменения: **не применялись**. Только SELECT настроек и агрегаты логов. Схемы, RLS, Auth и диагностика безопасности не изменялись.

Источники: [Logs Ingest](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest), [Egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

Последующий аудит: эти суточные агрегаты повторно не запрашивать. Они сами создали расход Logs Query; теперь действует ограничение начального окна 5 минут из AGENTS.md. Подтверждённые семь исторических вызовов и ограничения атрибуции описаны в [аудите Logs Query](SUPABASE-LOGS-QUERY-2026-10-31.md).
