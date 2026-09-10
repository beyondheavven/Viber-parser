import { describe, expect, it } from 'vitest';
import {
  generateMatchingFieldsUpdateSql,
  generateRosterInsertSql,
  generateUpdateSql,
  transformParticipantInfo,
  type RawParticipantInfo,
  type TransformedParticipant,
} from '../../src/viber/participants-service.js';
import {
  deduplicateParticipants,
  normalizePhone,
  type Participant,
} from '../../src/viber/repository.js';

describe('participants-service', () => {
  describe('transformParticipantInfo', () => {
    it('correctly transforms row with valid encrypted_member_id', () => {
      const row: RawParticipantInfo = {
        id: 42,
        memberId: 'em:AQAY8y8gyFai5BpvAACoLpy+vC3ItcZ2gLLl0f16A7pl+1QI1qRCMXd7',
        encryptedMemberId: 'em:AQAY8y8gyFai5BpvAACoLpy+vC3ItcZ2gLLl0f16A7pl+1QI1qRCMXd7',
        number: '+380501234567',
        participantType: 2,
        safeContact: 1,
        contactName: 'Alice',
        displayName: 'Alice D',
        viberName: 'Alice V',
      };

      const result = transformParticipantInfo(row);
      expect(result).toEqual({
        id: 42,
        name: 'Alice',
        oldMemberId: 'em:AQAY8y8gyFai5BpvAACoLpy+vC3ItcZ2gLLl0f16A7pl+1QI1qRCMXd7',
        newMemberId: 'GPMvIMhWouQ=',
        encryptedMemberId: 'em:AQAY8y8gyFai5BpvAACoLpy+vC3ItcZ2gLLl0f16A7pl+1QI1qRCMXd7',
        number: null,
        participantType: 1,
        safeContact: 0,
      });
    });

    it('returns null when encryptedMemberId is null or empty', () => {
      const row: RawParticipantInfo = {
        id: 1,
        memberId: 'some-id',
        encryptedMemberId: null,
        number: '+380500000000',
        participantType: 0,
        safeContact: 0,
        contactName: 'Self',
        displayName: null,
        viberName: null,
      };

      expect(transformParticipantInfo(row)).toBeNull();

      const emptyRow = { ...row, encryptedMemberId: '   ' };
      expect(transformParticipantInfo(emptyRow)).toBeNull();
    });

    it('skips self-account by default (participantType = 0) and includes it when requested', () => {
      const selfRow: RawParticipantInfo = {
        id: 1,
        memberId: 'Da54i3JfZcA=',
        encryptedMemberId: 'em:AQANrniLcl9lwBpvAAD45BjXack2KDDejNcNiXWX7KoogUod/74atmpL',
        number: '+380500000000',
        participantType: 0,
        safeContact: 0,
        contactName: 'Self Account',
        displayName: null,
        viberName: null,
      };

      // By default, skipped to protect bot login
      expect(transformParticipantInfo(selfRow)).toBeNull();

      // With includeSelf: true, transformed
      const transformed = transformParticipantInfo(selfRow, { includeSelf: true });
      expect(transformed).not.toBeNull();
      expect(transformed?.newMemberId).toBe('Da54i3JfZcA=');
      expect(transformed?.participantType).toBe(1);
    });

    it('handles invalid token gracefully and triggers onError callback', () => {
      const row: RawParticipantInfo = {
        id: 10,
        memberId: 'bad-token',
        encryptedMemberId: 'not-a-valid-token',
        number: null,
        participantType: 2,
        safeContact: 1,
        contactName: 'Corrupted',
        displayName: null,
        viberName: null,
      };

      let errorReported: Error | null = null;
      const result = transformParticipantInfo(row, undefined, (err) => {
        errorReported = err;
      });

      expect(result).toBeNull();
      expect(errorReported).not.toBeNull();
    });
  });

  describe('generateUpdateSql', () => {
    it('generates expected UPDATE statements', () => {
      const records: TransformedParticipant[] = [
        {
          id: 5,
          name: 'Bob',
          oldMemberId: 'old-1',
          newMemberId: 'GPMvIMhWouQ=',
          encryptedMemberId: 'em:...',
          number: null,
          participantType: 1,
          safeContact: 0,
        },
        {
          id: 6,
          name: 'Charlie',
          oldMemberId: 'old-2',
          newMemberId: 'Da54i3JfZcA=',
          encryptedMemberId: 'em:...',
          number: null,
          participantType: 1,
          safeContact: 0,
        },
      ];

      const sql = generateUpdateSql(records);
      expect(sql).toContain(
        "UPDATE participants_info SET member_id = 'GPMvIMhWouQ=', number = NULL, participant_type = 1, safe_contact = 0 WHERE _id = 5;",
      );
      expect(sql).toContain(
        "UPDATE participants_info SET member_id = 'Da54i3JfZcA=', number = NULL, participant_type = 1, safe_contact = 0 WHERE _id = 6;",
      );
    });
  });

  describe('generateRosterInsertSql', () => {
    it('generates expected INSERT and UPDATE statements with safe_contact = 0 and decoded member_id', () => {
      const members = [
        {
          emid: 'em:AQAY8y8gyFai5BpvAACoLpy+vC3ItcZ2gLLl0f16A7pl+1QI1qRCMXd7',
          name: "O'Connor",
          role: 2,
        },
      ];

      const sql = generateRosterInsertSql(members, 26);
      expect(sql).toContain('INSERT INTO participants_info');
      expect(sql).toContain("'GPMvIMhWouQ='"); // decoded em-key
      expect(sql).toContain("'em:AQAY8y8gyFai5BpvAACoLpy+vC3ItcZ2gLLl0f16A7pl+1QI1qRCMXd7'"); // raw mid
      expect(sql).toContain('safe_contact, contact_name, display_name, viber_name) SELECT');
      expect(sql).toContain(", 1, 0, 'O''Connor', 'O''Connor', 'O''Connor'"); // safe_contact = 0, contact_name = display_name = viber_name
      expect(sql).toContain('UPDATE participants_info SET member_id =');
      expect(sql).toContain("contact_name = 'O''Connor'");
      expect(sql).toContain('AND _id != 1 AND coalesce(participant_type, 1) != 0;');
      expect(sql).toContain('INSERT INTO participants (conversation_id, participant_info_id, active, group_role, group_role_local)');
      expect(sql).toContain('SELECT 26, pi._id, 1, 2, 2'); // role = 2 for admin
    });

    it('skips self account when selfEncryptedMemberId or selfMemberId is provided', () => {
      const members = [
        {
          emid: 'em:AQANrniLcl9lwBpvAAD45BjXack2KDDejNcNiXWX7KoogUod/74atmpL',
          name: 'Milena',
          role: 3,
        },
      ];

      const sql = generateRosterInsertSql(members, 26, {
        selfEncryptedMemberId: 'em:AQANrniLcl9lwBpvAAD45BjXack2KDDejNcNiXWX7KoogUod/74atmpL',
      });
      expect(sql).toBe('');
    });

    it('returns empty string for empty members list', () => {
      expect(generateRosterInsertSql([], 26)).toBe('');
    });
  });

  describe('generateMatchingFieldsUpdateSql', () => {
    it('generates UPDATE for rows where member_id, encrypted_member_id, and number have the same value', () => {
      const emid = 'em:AQAY8y8gyFai5BpvAACoLpy+vC3ItcZ2gLLl0f16A7pl+1QI1qRCMXd7';
      const rows: RawParticipantInfo[] = [
        {
          id: 100,
          memberId: emid,
          encryptedMemberId: emid,
          number: emid,
          participantType: 2,
          safeContact: 1,
          contactName: null,
          displayName: 'Lena',
          viberName: 'Lena',
        },
        {
          id: 101,
          memberId: 'GPMvIMhWouQ=',
          encryptedMemberId: emid,
          number: null,
          participantType: 1,
          safeContact: 0,
          contactName: null,
          displayName: 'Already Decoded',
          viberName: null,
        },
      ];

      const sql = generateMatchingFieldsUpdateSql(rows);
      expect(sql).toContain(
        "UPDATE participants_info SET member_id = 'GPMvIMhWouQ=', number = NULL, participant_type = 1, safe_contact = 0 WHERE _id = 100;",
      );
      expect(sql).not.toContain('WHERE _id = 101');
    });

    it('ignores rows where value cannot be decoded via em-key', () => {
      const rows: RawParticipantInfo[] = [
        {
          id: 102,
          memberId: 'invalid-emid',
          encryptedMemberId: 'invalid-emid',
          number: 'invalid-emid',
          participantType: 2,
          safeContact: 1,
          contactName: null,
          displayName: null,
          viberName: null,
        },
      ];

      const sql = generateMatchingFieldsUpdateSql(rows);
      expect(sql).toBe('');
    });

    it('never modifies the first record (id = 1) or self record (participantType = 0)', () => {
      const emid = 'em:AQAY8y8gyFai5BpvAACoLpy+vC3ItcZ2gLLl0f16A7pl+1QI1qRCMXd7';
      const rows: RawParticipantInfo[] = [
        {
          id: 1,
          memberId: emid,
          encryptedMemberId: emid,
          number: emid,
          participantType: 0,
          safeContact: 0,
          contactName: null,
          displayName: 'Me',
          viberName: null,
        },
      ];

      const sql = generateMatchingFieldsUpdateSql(rows);
      expect(sql).toBe('');
    });

    it('returns empty string for empty rows', () => {
      expect(generateMatchingFieldsUpdateSql([])).toBe('');
    });
  });

  describe('normalizePhone', () => {
    it('returns null for null, empty or encrypted em values', () => {
      expect(normalizePhone(null)).toBeNull();
      expect(normalizePhone('')).toBeNull();
      expect(normalizePhone('   ')).toBeNull();
      expect(normalizePhone('em:AQAY8y8gyFai5Bpv')).toBeNull();
      expect(normalizePhone('Ожидает дешифровки')).toBeNull();
    });

    it('normalizes digits from international phone numbers', () => {
      expect(normalizePhone('+380 (50) 123-45-67')).toBe('380501234567');
      expect(normalizePhone('+48 794 034 881')).toBe('48794034881');
      expect(normalizePhone('+1 (555) 123-4567')).toBe('15551234567');
    });
  });

  describe('deduplicateParticipants', () => {
    it('preserves unique participants', () => {
      const list: Participant[] = [
        {
          id: 1,
          memberId: 'm1',
          number: '+380501111111',
          name: 'Alice',
          contactName: null,
          viberName: null,
          groupRole: 1,
          roleLabel: 'superadmin',
          active: true,
          isSelf: false,
        },
        {
          id: 2,
          memberId: 'm2',
          number: '+380502222222',
          name: 'Bob',
          contactName: null,
          viberName: null,
          groupRole: 3,
          roleLabel: 'member',
          active: true,
          isSelf: false,
        },
      ];

      const result = deduplicateParticipants(list);
      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('Alice');
      expect(result[1]?.name).toBe('Bob');
    });

    it('deduplicates and merges records by memberId', () => {
      const list: Participant[] = [
        {
          id: 1,
          memberId: 'same_member',
          number: null,
          name: 'Alice Initial',
          contactName: null,
          viberName: null,
          groupRole: 3,
          roleLabel: 'member',
          active: true,
          isSelf: false,
          isOnline: false,
        },
        {
          id: 2,
          memberId: 'same_member',
          number: '+380501111111',
          name: 'Alice With Phone',
          contactName: 'Alice Contact',
          viberName: 'Alice Viber',
          groupRole: 2,
          roleLabel: 'admin',
          active: true,
          isSelf: false,
          isOnline: true,
          lastSeen: '2026-09-05T18:19:15.799Z',
        },
      ];

      const result = deduplicateParticipants(list);
      expect(result).toHaveLength(1);
      expect(result[0]?.memberId).toBe('same_member');
      expect(result[0]?.number).toBe('+380501111111');
      expect(result[0]?.roleLabel).toBe('admin');
      expect(result[0]?.contactName).toBe('Alice Contact');
      expect(result[0]?.isOnline).toBe(true);
      expect(result[0]?.lastSeen).toBe('2026-09-05T18:19:15.799Z');
    });

    it('deduplicates and merges records by phone number even if memberIds differ or are missing', () => {
      const list: Participant[] = [
        {
          id: 1,
          memberId: 'm_first',
          number: '+380509998877',
          name: 'Oleg',
          contactName: null,
          viberName: null,
          groupRole: 3,
          roleLabel: 'member',
          active: true,
          isSelf: false,
        },
        {
          id: 2,
          memberId: null,
          number: '+380 (50) 999-88-77',
          name: 'Oleg Petrov',
          contactName: null,
          viberName: null,
          groupRole: 1,
          roleLabel: 'superadmin',
          active: true,
          isSelf: false,
          isOnline: true,
        },
      ];

      const result = deduplicateParticipants(list);
      expect(result).toHaveLength(1);
      expect(result[0]?.memberId).toBe('m_first');
      expect(result[0]?.number).toBe('+380509998877');
      expect(result[0]?.roleLabel).toBe('superadmin');
      expect(result[0]?.isOnline).toBe(true);
    });
  });
});


