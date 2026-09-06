/** Raised when a participant has private messages turned off. */
export class ParticipantUnreachableError extends Error {
  constructor(readonly participant: string) {
    super(`Participant "${participant}" cannot receive private messages.`);
    this.name = 'ParticipantUnreachableError';
  }
}

/** Raised when a named participant is not present in the group's list. */
export class ParticipantNotFoundError extends Error {
  constructor(readonly participant: string) {
    super(`No participant named "${participant}" is visible in the group.`);
    this.name = 'ParticipantNotFoundError';
  }
}
