# FINORA

![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)

Веб-приложение бухгалтерского и управленческого учёта (в логике 1С:Бухгалтерии,
с современным UI). React + TypeScript + Tailwind, Firebase-backend, регистрация
через Telegram-бот.

> Замените `OWNER/REPO` в бейдже выше на путь вашего репозитория после публикации.

## Статус

Реализованы Этапы 1–8 из ТЗ (раздел 37):
- ✅ Архитектура проекта
- ✅ React/TypeScript frontend, дизайн-система
- ✅ Firebase подключение (конфигурация, требует ваших ключей в `.env`)
- ✅ Firebase Authentication (Login)
- ✅ Регистрация (форма)
- ✅ Telegram verification flow (UI + Cloud Functions логика кода)
- ✅ Автоматический вход после верификации
- ✅ Dashboard (метрики, быстрые действия, графики — на live-данных Firestore)
- ✅ Admin Login + Admin layout с разделами (Users/Database/Telegram/Settings/Audit Log)
- ✅ Firestore Security Rules (RBAC), Storage Rules

Ещё предстоит (Этапы 9–18):
- ⬜ CRUD-формы и таблицы для 19 модулей учёта (сейчас — заглушки `ModulePage`, честно показывающие, что модуль не подключён — согласно требованию не делать фейковые кнопки)
- ⬜ Полная Firestore schema для всех сущностей (товары, склад, контрагенты и т.д.)
- ⬜ Admin: реальные операции над пользователями/БД/ботом/настройками + Audit Log запись
- ⬜ Отчёты
- ⬜ Security review, UI/UX review
- ⬜ Production build и деплой

## Запуск локально

```bash
npm install
cp .env.example .env   # заполните значениями вашего Firebase-проекта
npm run dev
```

Для Cloud Functions:

```bash
cd functions
npm install
npm run build
firebase emulators:start
```

## Важно про секреты

- Telegram Bot Token **никогда** не должен попадать в frontend-код или `.env`
  фронтенда — только в Secret Manager Cloud Functions (`functions/src/telegram/webhook.ts`).
- Firebase Web config (`apiKey` и т.д.) не секрет в строгом смысле — реальная
  защита обеспечивается Security Rules (`firestore.rules`, `storage.rules`) и App Check.
- Пароль пользователя временно хранится в документе `telegramVerifications`
  до момента создания аккаунта, затем немедленно удаляется (см.
  `functions/src/verification/telegramVerification.ts`).

## Структура

См. `src/` (frontend) и `functions/src/` (backend). Полное дерево — в разделе 36 ТЗ.

## Вклад в проект

См. [CONTRIBUTING.md](./CONTRIBUTING.md).

## Лицензия

[MIT](./LICENSE) — при необходимости замените на проприетарную, если проект не open-source.
