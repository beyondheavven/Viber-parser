import { describe, expect, it, vi } from 'vitest';

import type { Sqlite } from '../../src/platform/sqlite.js';
import { ViberRepository } from '../../src/viber/repository.js';

describe('ViberRepository message sender identity', () => {
  it('falls back to encrypted_member_id when member_id is null or empty', () => {
    const query = vi.fn((_sql: string) => []);
    const repository = new ViberRepository({ query } as unknown as Sqlite);

    repository.messagesSince([{ conversationId: 26, sinceId: 0 }]);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain(
      "coalesce(nullif(pi.member_id, ''), nullif(pi.encrypted_member_id, ''))",
    );
  });
});
