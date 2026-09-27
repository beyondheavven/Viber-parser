import { describe, expect, it } from 'vitest';
import { shouldIngestMessageWrite } from '../../src/features/messages/message-watch.service.js';

describe('shouldIngestMessageWrite', () => {
  const enabled = new Set([20, 22]);

  it('ignores writes when no group is enabled', () => {
    expect(shouldIngestMessageWrite({ conversation_id: '20' }, new Set())).toBe(false);
  });

  it('wakes for an insert into an enabled group', () => {
    expect(shouldIngestMessageWrite({ conversation_id: '20', body: 'hi' }, enabled)).toBe(true);
  });

  it('ignores writes for groups that are not monitored', () => {
    expect(shouldIngestMessageWrite({ conversation_id: '7' }, enabled)).toBe(false);
  });

  it('wakes on an update that omits conversation_id (media URI filled in later)', () => {
    expect(shouldIngestMessageWrite({ extra_uri: 'content://img' }, enabled)).toBe(true);
  });
});
