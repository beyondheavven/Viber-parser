import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  openDevice: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

vi.mock('../../src/context.js', () => ({
  openDevice: mocks.openDevice,
}));

import { GroupsService } from '../../src/groups/groups.service.js';

const baseParticipant = {
  id: 42,
  memberId: 'member-42',
  number: '+380501234567',
  name: 'Alice',
  contactName: 'Alice',
  viberName: 'Alice',
  groupRole: 3,
  roleLabel: 'member' as const,
  active: true,
  isSelf: false,
};

describe('GroupsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    mocks.openDevice.mockResolvedValue({
      viber: {
        findGroup: vi.fn(() => ({ id: 26 })),
        conversations: vi.fn(() => []),
        participants: vi.fn(() => [{ ...baseParticipant }]),
      },
    });
  });

  it('instantiates correctly and provides methods', () => {
    const service = new GroupsService();
    expect(typeof service.getGroups).toBe('function');
    expect(typeof service.getGroup).toBe('function');
    expect(typeof service.getGroupParticipants).toBe('function');
  });

  it('reads groups from a live device without booting LDPlayer', async () => {
    mocks.openDevice.mockResolvedValue({
      viber: {
        conversations: vi.fn(() => []),
        groups: vi.fn(() => []),
      },
    });

    await new GroupsService().getGroups(true);

    expect(mocks.openDevice).toHaveBeenCalledWith({ ensureUp: false });
  });

  it('restores lastSeen from the current roster export envelope', async () => {
    mocks.readFileSync.mockReturnValue(
      JSON.stringify({
        participants: [
          {
            ...baseParticipant,
            isOnline: false,
            lastSeen: '2026-09-05T18:19:15.799Z',
          },
        ],
      }),
    );

    const result = await new GroupsService().getGroupParticipants(26);

    expect(result[0]?.isOnline).toBe(false);
    expect(result[0]?.lastSeen).toBe('2026-09-05T18:19:15.799Z');
  });

  it('supports legacy roster exports stored as a root array', async () => {
    mocks.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          ...baseParticipant,
          isOnline: false,
          lastSeen: '05.09.2026 18:19:15',
        },
      ]),
    );

    const result = await new GroupsService().getGroupParticipants(26);

    expect(result[0]?.lastSeen).toBe('05.09.2026 18:19:15');
  });
});
