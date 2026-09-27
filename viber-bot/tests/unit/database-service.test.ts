import { describe, expect, it } from 'vitest';
import { DatabaseService } from '../../src/features/database/database.service.js';

describe('DatabaseService', () => {
  it('instantiates correctly and provides methods', () => {
    const service = new DatabaseService();
    expect(typeof service.syncLiveDatabase).toBe('function');
    expect(typeof service.getDatabaseStats).toBe('function');
    expect(typeof service.decodeParticipants).toBe('function');
  });
});
