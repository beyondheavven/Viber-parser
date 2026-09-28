import { describe, expect, it } from 'vitest';
import {
  extractPhones,
  extractPrimaryPhone,
  normalizePhoneNumber,
} from '../../src/features/messages/phone-extractor.util.js';

describe('Phone Extractor Utility', () => {
  describe('normalizePhoneNumber', () => {
    it('normalizes 10-digit Ukrainian numbers starting with 0', () => {
      expect(normalizePhoneNumber('0501234567')).toBe('+380501234567');
      expect(normalizePhoneNumber('0988806081')).toBe('+380988806081');
      expect(normalizePhoneNumber('067 111 22 33')).toBe('+380671112233');
    });

    it('normalizes 12-digit Ukrainian numbers with 380', () => {
      expect(normalizePhoneNumber('+380501234567')).toBe('+380501234567');
      expect(normalizePhoneNumber('380501234567')).toBe('+380501234567');
      expect(normalizePhoneNumber('+38 (050) 123-45-67')).toBe('+380501234567');
      expect(normalizePhoneNumber('+380759726478')).toBe('+380759726478');
      expect(normalizePhoneNumber('0759726478')).toBe('+380759726478');
      expect(normalizePhoneNumber('+380771234567')).toBe('+380771234567');
    });

    it('normalizes Polish numbers', () => {
      expect(normalizePhoneNumber('+48512247055')).toBe('+48512247055');
      expect(normalizePhoneNumber('48512247055')).toBe('+48512247055');
    });

    it('rejects invalid, short, or repetitive numbers', () => {
      expect(normalizePhoneNumber('')).toBeNull();
      expect(normalizePhoneNumber('12345')).toBeNull();
      expect(normalizePhoneNumber('0000000000')).toBeNull();
      expect(normalizePhoneNumber('1111111111')).toBeNull();
      expect(normalizePhoneNumber('20260905')).toBeNull(); // 8 digits (date)
    });
  });

  describe('extractPhones & extractPrimaryPhone', () => {
    it('extracts number from plain Ukrainian text message', () => {
      const text = 'Терміново потрібен автовоз! Дзвонити за номером 0501234567 або пишіть у приват.';
      expect(extractPhones(text)).toEqual(['+380501234567']);
      expect(extractPrimaryPhone(text)).toBe('+380501234567');
    });

    it('extracts number with parentheses, spaces, and dashes', () => {
      const text = 'Маршрут Львів - Варшава. Контакт: +38 (067) 888-99-00, виїзд сьогодні о 18:00.';
      expect(extractPrimaryPhone(text)).toBe('+380678889900');
    });

    it('extracts phone correctly even when preceded by flight time and dates', () => {
      const text = '‼️07.09‼️\nКатовіце аероп - Рівне \n1 пас\nПриліт 11:00\n0502712435';
      expect(extractPhones(text)).toEqual(['+380502712435']);
      expect(extractPrimaryPhone(text)).toBe('+380502712435');
    });

    it('extracts multiple numbers without duplicates', () => {
      const text = 'Диспетчер 1: 050-111-22-33, диспетчер 2: 067-444-55-66, або 050-111-22-33.';
      const phones = extractPhones(text);
      expect(phones).toEqual(['+380501112233', '+380674445566']);
      expect(extractPrimaryPhone(text)).toBe('+380501112233');
    });

    it('returns empty when message has no phone numbers', () => {
      const text = 'Всім привіт! Які зараз черги на кордоні Шегині? Хто проїжджав годину тому?';
      expect(extractPhones(text)).toEqual([]);
      expect(extractPrimaryPhone(text)).toBeNull();
    });

    it('does not mistake dates, years, or currency prices for phone numbers', () => {
      const text = 'Ціна перевезення 1500 грн. Актуально на 05.09.2026. Рік випуску 2018.';
      expect(extractPhones(text)).toEqual([]);
      expect(extractPrimaryPhone(text)).toBeNull();
    });

    it('ignores internal media content:// URIs', () => {
      const text =
        'content://com.viber.voip.provider.internal_files/pg/0-04-05-60631ad9158bdc72dfa639aa460e67bc2aab90e7316b50ed328bc2ed1ce296a9/PG_MEDIA/jpg/400';
      expect(extractPhones(text)).toEqual([]);
      expect(extractPrimaryPhone(text)).toBeNull();
    });

    it('handles null, undefined, or empty text gracefully', () => {
      expect(extractPhones(null)).toEqual([]);
      expect(extractPhones(undefined)).toEqual([]);
      expect(extractPrimaryPhone(null)).toBeNull();
    });
  });
});
