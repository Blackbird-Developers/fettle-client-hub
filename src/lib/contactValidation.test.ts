import { describe, expect, it } from 'vitest';
import { emailError, joinPhone, phoneError, splitPhone } from './contactValidation';

describe('joinPhone', () => {
  it('drops the trunk zero and adds the prefix', () => {
    expect(joinPhone('IE', '087 123 4567')).toBe('+353 87 123 4567');
    expect(joinPhone('GB', '07400 123456')).toBe('+44 7400 123456');
  });
  it('lets a pasted international number win', () => {
    expect(joinPhone('IE', '+44 7400 123456')).toBe('+44 7400 123456');
    expect(joinPhone('IE', '0044 7400 123456')).toBe('+44 7400 123456');
  });
  it('is empty for an empty box', () => {
    expect(joinPhone('IE', '  ')).toBe('');
  });
});

describe('splitPhone', () => {
  it('reads international numbers', () => {
    expect(splitPhone('+44 7400 123456')).toEqual({ country: 'GB', local: '07400 123456' });
  });
  it('reads old Irish numbers without a prefix as Irish', () => {
    expect(splitPhone('0871234567').country).toBe('IE');
  });
  it('defaults to Ireland when empty', () => {
    expect(splitPhone('')).toEqual({ country: 'IE', local: '' });
  });
});

describe('phoneError', () => {
  it('accepts real numbers', () => {
    expect(phoneError('+353 87 123 4567')).toBeUndefined();
    expect(phoneError('+353 1 234 5678')).toBeUndefined();
    expect(phoneError('+44 7400 123456')).toBeUndefined();
  });
  it('rejects an Irish mobile missing a digit', () => {
    expect(phoneError('+353 87 123 456')).toMatch(/missed a digit/);
  });
  it('rejects a UK mobile missing a digit', () => {
    expect(phoneError('+44 7400 12345')).toBeDefined();
  });
  it('rejects an extra digit', () => {
    expect(phoneError('+353 87 123 45678')).toBeDefined();
  });
  it('rejects letters', () => {
    expect(phoneError('+353 87 abc')).toBeDefined();
  });
  it('requires a number only when asked', () => {
    expect(phoneError('')).toBeUndefined();
    expect(phoneError('', { required: true })).toBe('Please enter your mobile number');
  });
});

describe('Kosovo numbers', () => {
  it('joins, splits and validates +383 numbers', () => {
    expect(joinPhone('XK', '044 169 411')).toBe('+383 44 169 411');
    expect(splitPhone('+383 44 169 411')).toEqual({ country: 'XK', local: '044 169 411' });
    expect(phoneError('+383 44 169 411')).toBeUndefined();
    expect(phoneError('+383 44 169 41')).toBeDefined();
  });
});

describe('emailError', () => {
  it('accepts normal addresses', () => {
    expect(emailError('sarah.byrne@gmail.com')).toBeUndefined();
    expect(emailError('a@fettle.ie')).toBeUndefined();
  });
  it('rejects malformed addresses', () => {
    expect(emailError('sarah@gmail')).toBeDefined();
    expect(emailError('sarah@gmail.c')).toBeDefined();
    expect(emailError('sarah gmail.com')).toBeDefined();
  });
  it('suggests the fix for common typos', () => {
    expect(emailError('sarah@gmial.com')).toBe('Did you mean sarah@gmail.com?');
    expect(emailError('sarah@hotmail.co')).toBe('Did you mean sarah@hotmail.com?');
  });
});
