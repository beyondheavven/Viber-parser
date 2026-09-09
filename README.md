# Viber Parser & Automation System

Система для автоматизации, мониторинга сообщений и парсинга участников приложения **Viber Android** внутри эмулятора (Docker Android).

---

## 🏗 Архитектура

Система построена на взаимодействии двух независимых сервисов через брокер сообщений **RabbitMQ**:

```
                                  ┌─────────────────────────────────────────┐
                                  │           RabbitMQ Broker               │
                                  │      (AMQP :5672, Web UI :15672)        │
                                  └────────▲───────────────────────┬────────┘
                                           │                       │
                      RPC Commands / Reply │                       │ Pub/Sub Events
                      (viber_commands_queue)                       │ (task progress, new messages)
                                           │                       │
      ┌────────────────────────────────────┴───┐     ┌─────────────▼──────────────────────────┐
      │           viber-parser-api             │     │               viber-bot                │
      │         (Kotlin 2.1 / Ktor 3.5)        │     │          (Node.js 22 / NestJS 12)      │
      │                                        │     │                                        │
      │ • Публичный REST API + Swagger UI      │     │                                        │
      │ • Supabase Auth & JWT валидация        │     │ • Appium UiAutomator2 автоматизация    │
      │ • RabbitMQ RPC Client (Direct Reply-To)│     │ • Root ADB + SQLite парсер базы Viber  │
      │ • Шлюз для UI и внешних интеграций     │     │ • Frida Dynamic Hooking (перехват)     │
      └────────────────────────────────────────┘     └───────────────────┬────────────────────┘
                                                                         │
                                                                         ▼
                                                     ┌────────────────────────────────────────┐
                                                     │         Android Emulator / Device      │
                                                     │    (Viber VoIP App / Root SQLite)      │
                                                     └────────────────────────────────────────┘
```

---

## 📦 Компоненты системы

### 1. `viber-parser-api` (Control Plane / Gateway)
- **Стек**: Kotlin 2.1, Ktor 3.5, Netty, Coroutines.
- **Назначение**:
  - Единая точка входа для клиентов и веб-интерфейса.
  - Интерактивная документация **OpenAPI / Swagger UI** (`/swagger`).
  - Интеграция с **Supabase** (аутентификация и хранилище данных).
  - Преобразование входящих HTTP-запросов в RabbitMQ RPC-команды к боту и возврат результатов.

### 2. `viber-bot` (Worker / Microservice)
- **Стек**: Node.js 22, TypeScript 5.9, NestJS 12 (`@nestjs/microservices`), WebDriverIO, Appium 2, Frida.
- **Назначение**:
  - Полностью изолированный микросервис (нет открытых веб-портов).
  - Слушает очередь `viber_commands_queue` (`prefetch: 1` для защиты эмулятора от параллельных гонок).
  - Взаимодействует с Android через Root ADB и Appium UIAutomator2.
  - Читает и синхронизирует локальную базу данных Viber SQLite (`viber_messages`).
  - Перехватывает входящие сообщения через Frida hook и мгновенно публикует события в RabbitMQ.

### 3. `rabbitmq` (Message Broker)
- Управляет очередями команд и доставкой событий в реальном времени.
- Включает **Management UI** для мониторинга очередей, скорости обработки и соединений на порту `15672`.

---

## 🚀 Быстрый старт через Docker Compose

### 1. Подготовка переменных окружения
Скопируйте файлы конфигурации и укажите ваши параметры:
```bash
cp .env.example .env
cp .env.bot.example .env.bot
```

### 2. Запуск всего стека
```bash
docker compose up --build -d
```

Сервисы будут доступны по адресам:
- **Swagger UI (Ktor REST API)**: [http://localhost:8080/swagger](http://localhost:8080/swagger)
- **OpenAPI Schema**: [http://localhost:8080/api.json](http://localhost:8080/api.json)
- **RabbitMQ Management UI**: [http://localhost:15672](http://localhost:15672) *(логин/пароль по умолчанию: `viber` / `viber_secret`)*
- **Scrcpy Web (трансляция экрана эмулятора)**: [http://localhost:8000](http://localhost:8000)

---

## 🛠 Локальная разработка

### Требования:
- **JDK 21**
- **Node.js >= 22** и **npm**
- **RabbitMQ** (запущенный локально или в Docker)
- **Android SDK** (`adb`) и подключенный эмулятор (например, LDPlayer на `127.0.0.1:5555`)
- **Appium 2** с установленным драйвером `uiautomator2`:
  ```bash
  npm install -g appium
  appium driver install uiautomator2
  ```

### Запуск сервисов по отдельности:

#### 1. Запуск RabbitMQ (если нет локального):
```bash
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=viber \
  -e RABBITMQ_DEFAULT_PASS=viber_secret \
  rabbitmq:3-management-alpine
```

#### 2. Запуск TypeScript бота (`viber-bot`):
```bash
cd viber-bot
npm install
npm run start:api
```

#### 3. Запуск Ktor API:
```bash
./gradlew run
# На Windows:
.\gradlew.bat run
```

---

## 📡 REST API & Паттерны RabbitMQ

Ktor API принимает внешние HTTP-запросы и делегирует их в очередь RabbitMQ:

### Авторизация в Viber
| Метод | HTTP Эндпоинт | Паттерн RabbitMQ | Описание |
|---|---|---|---|
| `POST` | `/api/auth/phone` | `viber.auth.phone` | Ввод номера телефона для входа в Viber |
| `POST` | `/api/auth/code` | `viber.auth.code` | Ввод 6-значного кода подтверждения из SMS |
| `GET` | `/api/auth/status` | `viber.auth.status` | Проверка текущего статуса авторизации приложения |

### Группы и чаты
| Метод | HTTP Эндпоинт | Паттерн RabbitMQ | Описание |
|---|---|---|---|
| `GET` | `/api/groups` | `viber.groups.get_all` | Получить список всех групп из базы Viber |
| `GET` | `/api/groups/{id}` | `viber.groups.get_by_id` | Детальная информация о группе |
| `GET` | `/api/groups/{id}/participants` | `viber.groups.get_participants` | Список участников конкретной группы |

### Сбор участников и задачи
| Метод | HTTP Эндпоинт | Паттерн RabbitMQ | Описание |
|---|---|---|---|
| `POST` | `/api/participants/collect` | `viber.participants.collect` | Запуск фоновой задачи скроллинга и сбора участников |
| `POST` | `/api/participants/online-status` | `viber.participants.online_status` | Проверка статуса онлайн участников через Frida |
| `GET` | `/api/tasks` | `viber.tasks.get_all` | Список всех запущенных и завершенных задач |
| `GET` | `/api/tasks/{id}` | `viber.tasks.get_by_id` | Детали и текущий шаг конкретной задачи |
| `GET` | `/api/tasks/{id}/participants` | `viber.participants.get_task_participants` | Получить собранный результат задачи |
| `POST` | `/api/tasks/{id}/stop` | `viber.tasks.stop` | Прервать выполнение задачи |

### База данных SQLite
| Метод | HTTP Эндпоинт | Паттерн RabbitMQ | Описание |
|---|---|---|---|
| `POST` | `/api/database/sync` | `viber.database.sync` | Принудительная синхронизация SQLite snapshot с эмулятора |
| `GET` | `/api/database/stats` | `viber.database.stats` | Статистика по сообщениям, контактам и беседам |
| `POST` | `/api/database/decode` | `viber.database.decode` | Декодирование `encrypted_member_id` участников |

### Мониторинг входящих сообщений
| Метод | HTTP Эндпоинт | Паттерн RabbitMQ | Описание |
|---|---|---|---|
| `POST` | `/api/messages/monitor/start` | `viber.messages.monitor.start` | Запуск фонового мониторинга новых сообщений |
| `POST` | `/api/messages/monitor/stop` | `viber.messages.monitor.stop` | Остановка мониторинга |
| `GET` | `/api/messages/monitor/status` | `viber.messages.monitor.status` | Статус мониторинга (Frida hook / Polling) |
| `GET` | `/api/messages/monitored` | `viber.messages.get_monitored` | Получение перехваченных сообщений с фильтрами |
| `GET` | `/api/messages/monitored/export` | `viber.messages.export` | Экспорт перехваченных сообщений в JSON/CSV |

---

## 🔔 Потоковые события (Pub/Sub)

Бот публикует асинхронные события в брокер через `RabbitMqPublisher`:
- **`viber.task.event`**: События жизненного цикла фоновых задач (создание, текущий шаг скроллинга, прогресс, ошибка, завершение).
- **`viber.message.received`**: Перехват нового сообщения в чате в реальном времени.

---

## 🔒 Безопасность и конфигурация

- **Изоляция устройства**: Эмулятор может выполнять только одну тяжелую UI-операцию за раз. Очередь RabbitMQ (`prefetch: 1`) гарантирует последовательное выполнение задач без взаимных блокировок.
- **Безопасность базы**: Работа с базой данных `viber_messages` происходит исключительно через создание временных snapshot-копий во избежание повреждения SQLite WAL журналов на активном эмуляторе.
