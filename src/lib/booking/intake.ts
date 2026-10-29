// Acuity intake-form answers sent with a wizard booking, per service, as
// checked on the live Acuity forms (docs/QUIZ_BOOKING_FLOW.md §0.4, §4.6).
// Every consent is required to reach Payment, so consents are always "yes".

import type { TherapyService } from './therapists';

export interface IntakeField {
  id: number;
  value: string;
}

export const INTAKE_FIELD = {
  over18: 10466116,
  contact: 9292394,
  terms: 9292405,
  partnerName: 10104284,
  youthConsent: 13686405,
  psychologistTerms: 9291898,
} as const;

export function intakeFieldsFor(service: TherapyService | 'psychologist', partnerName?: string): IntakeField[] {
  if (service === 'psychologist') {
    return [{ id: INTAKE_FIELD.psychologistTerms, value: 'yes' }];
  }
  if (service === 'youth') {
    // Youth types require the consent-form acknowledgement and don't have
    // the over-18 or contact fields.
    return [
      { id: INTAKE_FIELD.youthConsent, value: 'yes' },
      { id: INTAKE_FIELD.terms, value: 'yes' },
    ];
  }
  const fields: IntakeField[] = [
    { id: INTAKE_FIELD.over18, value: 'yes' },
    { id: INTAKE_FIELD.contact, value: 'yes' },
    { id: INTAKE_FIELD.terms, value: 'yes' },
  ];
  const partner = partnerName?.trim();
  if (service === 'couples' && partner) fields.push({ id: INTAKE_FIELD.partnerName, value: partner });
  return fields;
}
