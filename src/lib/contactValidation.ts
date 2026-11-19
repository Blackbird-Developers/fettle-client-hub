// Phone and email checks shared by every form that collects contact details.
// Phones are stored as one international string ("+353 87 123 4567") so
// Acuity, the CRM and the sales tools keep receiving a single value; the form
// splits it into a country prefix dropdown plus the local number.

import { getCountryCallingCode, parsePhoneNumberFromString, validatePhoneNumberLength, type CountryCode } from 'libphonenumber-js/max';

export interface PhoneCountry {
  code: CountryCode;
  name: string;
  /** Short label shown in the closed prefix box, e.g. "IRL". */
  short: string;
  flag: string;
}

/** Ireland first (most clients), then the UK and Kosovo, then the rest alphabetically. */
export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: 'IE', name: 'Ireland', short: 'IRL', flag: '🇮🇪' },
  { code: 'GB', name: 'United Kingdom', short: 'UK', flag: '🇬🇧' },
  { code: 'XK', name: 'Kosovo', short: 'KOS', flag: '🇽🇰' },
  { code: 'AL', name: 'Albania', short: 'ALB', flag: '🇦🇱' },
  { code: 'AU', name: 'Australia', short: 'AUS', flag: '🇦🇺' },
  { code: 'AT', name: 'Austria', short: 'AUT', flag: '🇦🇹' },
  { code: 'BE', name: 'Belgium', short: 'BEL', flag: '🇧🇪' },
  { code: 'BR', name: 'Brazil', short: 'BRA', flag: '🇧🇷' },
  { code: 'CA', name: 'Canada', short: 'CAN', flag: '🇨🇦' },
  { code: 'HR', name: 'Croatia', short: 'CRO', flag: '🇭🇷' },
  { code: 'CZ', name: 'Czechia', short: 'CZE', flag: '🇨🇿' },
  { code: 'DK', name: 'Denmark', short: 'DEN', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', short: 'FIN', flag: '🇫🇮' },
  { code: 'FR', name: 'France', short: 'FRA', flag: '🇫🇷' },
  { code: 'DE', name: 'Germany', short: 'GER', flag: '🇩🇪' },
  { code: 'GR', name: 'Greece', short: 'GRE', flag: '🇬🇷' },
  { code: 'HU', name: 'Hungary', short: 'HUN', flag: '🇭🇺' },
  { code: 'IN', name: 'India', short: 'IND', flag: '🇮🇳' },
  { code: 'IT', name: 'Italy', short: 'ITA', flag: '🇮🇹' },
  { code: 'LV', name: 'Latvia', short: 'LAT', flag: '🇱🇻' },
  { code: 'LT', name: 'Lithuania', short: 'LTU', flag: '🇱🇹' },
  { code: 'LU', name: 'Luxembourg', short: 'LUX', flag: '🇱🇺' },
  { code: 'NL', name: 'Netherlands', short: 'NED', flag: '🇳🇱' },
  { code: 'NZ', name: 'New Zealand', short: 'NZ', flag: '🇳🇿' },
  { code: 'NG', name: 'Nigeria', short: 'NGA', flag: '🇳🇬' },
  { code: 'MK', name: 'North Macedonia', short: 'MKD', flag: '🇲🇰' },
  { code: 'NO', name: 'Norway', short: 'NOR', flag: '🇳🇴' },
  { code: 'PK', name: 'Pakistan', short: 'PAK', flag: '🇵🇰' },
  { code: 'PH', name: 'Philippines', short: 'PHI', flag: '🇵🇭' },
  { code: 'PL', name: 'Poland', short: 'POL', flag: '🇵🇱' },
  { code: 'PT', name: 'Portugal', short: 'POR', flag: '🇵🇹' },
  { code: 'RO', name: 'Romania', short: 'ROU', flag: '🇷🇴' },
  { code: 'SK', name: 'Slovakia', short: 'SVK', flag: '🇸🇰' },
  { code: 'ZA', name: 'South Africa', short: 'RSA', flag: '🇿🇦' },
  { code: 'ES', name: 'Spain', short: 'ESP', flag: '🇪🇸' },
  { code: 'SE', name: 'Sweden', short: 'SWE', flag: '🇸🇪' },
  { code: 'CH', name: 'Switzerland', short: 'SUI', flag: '🇨🇭' },
  { code: 'AE', name: 'United Arab Emirates', short: 'UAE', flag: '🇦🇪' },
  { code: 'US', name: 'United States', short: 'USA', flag: '🇺🇸' },
];

export const DEFAULT_PHONE_COUNTRY: CountryCode = 'IE';

/** Example local number per country, for the placeholder. */
const LOCAL_EXAMPLES: Partial<Record<CountryCode, string>> = {
  IE: '87 123 4567',
  GB: '7400 123456',
  US: '201 555 0123',
  CA: '506 234 5678',
  XK: '44 123 456',
};

export function dialCode(country: CountryCode): string {
  return `+${getCountryCallingCode(country)}`;
}

export function localPlaceholder(country: CountryCode): string {
  return LOCAL_EXAMPLES[country] ?? 'Mobile number';
}

/**
 * Split a stored phone into the dropdown country and the local digits. A
 * number without a "+" (older bookings, e.g. "087 123 4567") is read as
 * belonging to `fallback`.
 */
export function splitPhone(value: string, fallback: CountryCode = DEFAULT_PHONE_COUNTRY): { country: CountryCode; local: string } {
  const raw = value.trim();
  if (!raw) return { country: fallback, local: '' };
  const parsed = parsePhoneNumberFromString(raw.startsWith('00') ? `+${raw.slice(2)}` : raw, fallback);
  if (parsed?.country && PHONE_COUNTRIES.some((c) => c.code === parsed.country)) {
    return { country: parsed.country, local: parsed.formatNational() };
  }
  if (raw.startsWith('+')) {
    // A country outside the dropdown: keep what they typed so nothing is lost.
    const match = PHONE_COUNTRIES.find((c) => raw.replace(/\s/g, '').startsWith(dialCode(c.code)));
    if (match) return { country: match.code, local: raw.replace(/\s/g, '').slice(dialCode(match.code).length) };
  }
  return { country: fallback, local: raw };
}

/**
 * Combine the dropdown and the local number into the stored value. A leading
 * trunk "0" (Irish "087…", UK "07…") is dropped, so "+353 087…" never happens.
 * If someone pastes a full "+44…" number into the local box, that wins.
 */
export function joinPhone(country: CountryCode, local: string): string {
  const raw = local.trim();
  if (!raw) return '';
  const candidate = raw.startsWith('+') || raw.startsWith('00') ? `+${raw.replace(/^(\+|00)/, '')}` : raw;
  const parsed = parsePhoneNumberFromString(candidate, country);
  if (parsed) return parsed.formatInternational();
  return `${dialCode(country)} ${raw.replace(/^0+/, '')}`;
}

/** Error message for a phone value, or undefined when it is a real, dialable number. */
export function phoneError(value: string, opts: { required?: boolean } = {}): string | undefined {
  const raw = value.trim();
  if (!raw) return opts.required ? 'Please enter your mobile number' : undefined;
  if (!/^[\d\s+\-().]+$/.test(raw)) return 'Phone numbers can only contain digits, spaces and +';
  const parsed = parsePhoneNumberFromString(raw, DEFAULT_PHONE_COUNTRY);
  if (!parsed) return 'Please enter a valid phone number';
  if (parsed.isValid()) return undefined;
  // Say which way it is wrong: the most common mistake is a missing digit.
  const length = validatePhoneNumberLength(raw, DEFAULT_PHONE_COUNTRY);
  if (length === 'TOO_LONG') return 'This number has too many digits. Please check it';
  return 'This number looks incomplete or incorrect. Please check you haven’t missed a digit';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Frequent typos of the big mail providers, mapped to the intended domain. */
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.ie': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.om': 'gmail.com',
  'gmail.comm': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmil.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'outlook.con': 'outlook.com',
  'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'iclod.com': 'icloud.com',
  'icloud.co': 'icloud.com',
  'icloud.con': 'icloud.com',
  'eircom.ner': 'eircom.net',
};

/** Error message for an email, or undefined when it looks deliverable. */
export function emailError(value: string, opts: { required?: boolean } = { required: true }): string | undefined {
  const email = value.trim();
  if (!email) return opts.required === false ? undefined : 'Please enter your email';
  if (email.length > 100 || !EMAIL_RE.test(email) || email.includes('..')) return 'Please enter a valid email address';
  const [user, domain] = email.split('@');
  const fix = DOMAIN_TYPOS[domain.toLowerCase()];
  if (fix) return `Did you mean ${user}@${fix}?`;
  return undefined;
}
