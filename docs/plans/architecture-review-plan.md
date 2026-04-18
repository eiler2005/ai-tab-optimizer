# План: архитектурная уборка + полные тесты + документация

## Summary

Считаем проект локальным single-user инструментом, где сейчас приоритет не security hardening, а приведение системы в поддерживаемое состояние. Ближайшая итерация должна одновременно:

- убрать несоответствия между кодом и docs;
- декомпозировать монолитные runtime-части;
- зафиксировать persistence/migration policy;
- добавить тестовое покрытие на критические потоки;
- выпустить обновлённую техническую документацию, достаточную для следующего инженера.

## Implementation Changes

1. Нормализовать архитектуру без изменения внешнего поведения.
   - Разделить backend на внутренние модули: DB/schema+migrations, provider adapters, analysis orchestration, chat/analytics, HTTP routes.
   - Разделить extension background на transport к серверу, orchestration AI-analysis, persistence/history/snapshots, message router.
   - Сохранить текущие message types и HTTP endpoints совместимыми; UI и persisted data не должны требовать ручной перенастройки.

2. Привести данные и retention к одному контракту.
   - Выбрать одно каноническое TTL/retention-поведение для `url_analysis` и логов и использовать его и в коде, и в документации.
   - Ввести явную версионизацию схемы SQLite и последовательные миграции вместо ad hoc `ALTER TABLE ... try/except`.
   - Задокументировать lifecycle данных: что хранится, как долго, кем используется, что можно безопасно очищать.

3. Обновить продуктовую и инженерную документацию.
   - `README.md`: честное позиционирование, фактическая privacy-модель, актуальный quick start, реальные ограничения и feature overview.
   - `SETUP.md`: рабочий dev flow, диагностика сервера, как проверять CLI providers, как запускать тесты, как отлаживать background/service worker.
   - `PROJECT.md`: актуальная архитектурная схема, ownership слоёв, data flow, persistence contract, migration strategy, failure modes и testing strategy.
   - Добавить короткий `ARCHITECTURE.md` или раздел в `PROJECT.md` с decision-level описанием модулей и их границ, чтобы implementer не читал весь код для входа.
   - Добавить `TESTING.md` или раздел в `SETUP.md` с матрицей тестов: unit, integration, contract, smoke.

4. Расширить тестовое покрытие до критических сценариев.
   - Backend integration tests:
     - `/health`, `/settings`, `/analyze`, `/analyze/cancel`, `/analysis-runs`, `/chat`, `/analytics/refresh`;
     - cache hit/miss, provider success/failure, fallback на второй provider, heuristic fallback;
     - resume/stopped/completed run states;
     - миграции БД на пустой и уже существующей схеме.
   - Backend unit tests:
     - normalization of settings;
     - retention/cleanup logic;
     - parsing/validation of provider outputs;
     - cache namespace and provider/model key behavior.
   - Extension/background tests:
     - server URL normalization and localhost fallback candidates;
     - message routing for key commands;
     - analysis orchestration state transitions;
     - behavior when server unavailable, timeout, partial result, cancel, resume.
   - Shared/domain tests:
     - message/type contract invariants;
     - aggregation logic for recommendations, analytics summaries, history transforms.
   - Smoke tests:
     - build/typecheck/python compile remain green;
     - one lightweight end-to-end local flow: server up, analyze request, expected response shape.

## Public Interfaces / Contracts

- Не менять shape текущих REST endpoints и `shared/types/messages.ts` в этой итерации.
- Разрешены только внутренние refactor-слои и дополнительные internal interfaces.
- Если в ходе работ обнаружится необходимое API-изменение, оно должно быть:
  - минимальным;
  - обратно совместимым;
  - отдельно отражённым в docs и contract tests.

## Test Plan

- Python:
  - `pytest` покрывает backend routes, migrations, provider fallback, cache/retention.
- TypeScript:
  - `vitest` покрывает shared utils, background transport/orchestration, contract-level mapping.
- Build validation:
  - `pnpm --dir extension typecheck`
  - `pnpm build`
  - `.venv/bin/python -m py_compile agent.py`
  - `.venv/bin/pytest`
- Acceptance scenarios:
  - fresh install path по `SETUP.md` воспроизводим;
  - side panel может подключиться к серверу и получить health/analyze response;
  - docs не противоречат коду по TTL, provider chain, server URL и persistence behavior.

## Assumptions

- Security hardening не входит в эту итерацию, кроме исправления ложных обещаний в документации.
- Проект остаётся локальным single-user tool, не self-hosted multi-user сервисом.
- Приоритет выполнения:
  1. унификация docs + retention contract
  2. backend modularization + migrations
  3. background modularization
  4. test suite expansion
  5. финальная документация по architecture/testing
- Definition of done:
  - код рефакторен без изменения внешнего поведения;
  - критические сценарии покрыты тестами;
  - `README`, `SETUP`, `PROJECT` и testing/architecture docs синхронизированы между собой и с кодом.
