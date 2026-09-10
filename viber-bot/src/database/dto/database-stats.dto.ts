export class DatabaseStatsDto {
  /** Количество чатов/бесед в базе данных. */
  conversationsCount!: number;

  /** Количество участников в базе данных. */
  participantsCount!: number;

  /** Количество участников с недешифрованными member_id. */
  undecodedParticipantsCount!: number;

  /** Всего сообщений в базе данных. */
  messagesCount!: number;
}

export class SyncResultDto {
  success!: boolean;

  message!: string;

  timestamp!: string;

  stats!: DatabaseStatsDto;
}
