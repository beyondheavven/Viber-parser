import { describe, expect, it } from 'vitest';

import { extractEmKey } from '../../src/viber/em-key.js';

describe('extractEmKey', () => {
  it('extracts the key identifier from an em token', () => {
    expect(extractEmKey('em:AQAY8y8gyFai5BpvAACoLpy+vC3ItcZ2gLLl0f16A7pl+1QI1qRCMXd7')).toBe(
      'GPMvIMhWouQ=',
    );
  });

  it('accepts a token without the em prefix', () => {
    expect(extractEmKey('AQANrniLcl9lwBpvAAD45BjXack2KDDejNcNiXWX7KoogUod/74atmpL')).toBe(
      'Da54i3JfZcA=',
    );
  });

  it('rejects a blob of the wrong length', () => {
    expect(() => extractEmKey('em:AQAA')).toThrow('Expected a 42-byte em blob');
  });
});
