# Contributing to FINORA

## Установка

```bash
npm install
cp .env.example .env
npm run dev
```

## Правила

- Все CRUD-операции подключаются к Firebase — никакого mock-данных в production-коде.
- Каждая кнопка либо выполняет действие, либо ведёт на реальный экран, либо явно
  показывает "функция ещё не настроена" (см. `src/pages/ModulePage.tsx` как образец).
- Роль пользователя никогда не проверяется только на клиенте — финальная проверка
  всегда в Firestore Security Rules / Cloud Functions.
- Секреты (Telegram Bot Token, service account) никогда не коммитятся и не идут
  во frontend — только Secret Manager / переменные окружения Cloud Functions.
- Перед PR: `npm run typecheck`, `npm run lint`, `npm run build` должны проходить
  без ошибок (это же проверяет CI).

## Структура веток

- `main` — стабильная ветка, деплоится на production
- `feature/<этап>-<модуль>` — например `feature/9-sales-module`

## Коммиты

Формат: `<область>: <что сделано>`, например:
`sales: добавить форму создания документа продажи`
