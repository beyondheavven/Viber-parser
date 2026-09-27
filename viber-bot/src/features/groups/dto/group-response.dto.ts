export class GroupParticipantSampleDto {
  id!: number;

  name!: string | null;

  number!: string | null;

  roleLabel!: string;
}

export class GroupSummaryDto {
  /** ID беседы (row ID). */
  id!: number;

  /** Тип беседы (0: 1-to-1, 1: группа, 2: сообщество, 3: рассылка). */
  type!: number;

  /** 64-битный ID группы в Viber. */
  groupId?: string | null;

  /** Название группы/чата. */
  name?: string | null;

  /** Количество сообщений в чате. */
  messageCount!: number;

  /** Количество участников в чате. */
  participantCount!: number;

  /** Количество непрочитанных сообщений. */
  unreadCount!: number;

  /** Дата последнего сообщения (ISO 8601). */
  lastMessageDate?: string | null;
}

export class GroupDetailDto extends GroupSummaryDto {
  /** Список активных участников группы (краткая выгрузка). */
  sampleParticipants?: GroupParticipantSampleDto[];
}
