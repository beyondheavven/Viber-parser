export class ParticipantDto {
  /** Внутренний числовой ID записи участника в SQLite (_id в таблице participants). */
  id!: number;

  /** Уникальный зашифрованный ID участника в Viber (member_id / encrypted_member_id). */
  memberId!: string | null;

  /** Номер телефона в международном формате E.164 (null, если скрыт настройками приватности Viber). */
  number!: string | null;

  /** Отображаемое имя участника (наиболее полное и актуальное). */
  name!: string | null;

  /** Имя из телефонной книги контактов устройства (contact_name). */
  contactName!: string | null;

  /** Публичное имя профиля Viber (viber_name). */
  viberName!: string | null;

  /** Числовой код роли в группе (1: superadmin, 2: admin, 3: member). */
  groupRole!: number | null;

  /** Текстовое обозначение роли. */
  roleLabel!: 'superadmin' | 'admin' | 'member' | 'unknown';

  /** Флаг активности участника в чате. */
  active!: boolean;

  /** Флаг, является ли данный участник текущим аккаунтом бота (participant_type == 0). */
  isSelf!: boolean;

  /** Флаг, находится ли пользователь в сети прямо сейчас. */
  isOnline?: boolean;

  /** Дата и время последней активности пользователя (ISO 8601 UTC). */
  lastSeen?: string | null;
}

export class TaskCollectionResultDto {
  /** Название группы/сообщества. */
  group!: string;

  /** Числовой ID беседы в SQLite базе данных Viber. */
  conversationId!: number;

  /** 64-битный ID группы в Viber. */
  groupId!: string;

  /** Количество участников, заявленное в заголовке Viber UI (null, если не распознано). */
  headerTotal?: number | null;

  /** Количество успешно пролистанных страниц списка участников в Viber. */
  pagesCount!: number;

  /** Общее количество извлеченных и синхронизированных участников. */
  participantsCount!: number;

  /** Количество участников с известным номером телефона. */
  participantsWithPhone!: number;

  /** Абсолютный путь к файлу выгрузки в формате JSON. */
  savedJsonPath!: string;

  /** Абсолютный путь к файлу выгрузки в формате TXT (таблица). */
  savedTxtPath!: string;

  /** Абсолютный путь к файлу выгрузки в формате CSV. */
  savedCsvPath!: string;
}
