// "Your details" validation for the booking wizard
// (docs/QUIZ_BOOKING_FLOW.md §3.4). Rules and messages are the fettle.ie
// booking page's.

import { emailError, phoneError } from '../contactValidation';
import type { TherapyService } from './therapists';

export interface BookingDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  partnerName: string;
  youngPersonName: string;
  note: string;
}

export type DetailsErrors = Partial<Record<'firstName' | 'lastName' | 'email' | 'phone' | 'partnerName', string>>;

/** Field order, so the first error can be focused. */
export const DETAILS_FIELD_ORDER = ['firstName', 'lastName', 'email', 'phone', 'partnerName'] as const;

function nameError(value: string, label: 'First' | 'Last'): string | undefined {
  if (!value) return `Please enter your ${label.toLowerCase()} name`;
  if (value.length < 2) return `${label} name must be at least 2 characters`;
  if (value.length > 50) return `${label} name must be under 50 characters`;
  return undefined;
}

export function validateDetails(details: BookingDetails, service: TherapyService | 'psychologist'): DetailsErrors {
  const d = {
    firstName: details.firstName.trim(),
    lastName: details.lastName.trim(),
    email: details.email.trim(),
    phone: details.phone.trim(),
    partnerName: details.partnerName.trim(),
  };
  const errors: DetailsErrors = {};
  const first = nameError(d.firstName, 'First');
  if (first) errors.firstName = first;
  const last = nameError(d.lastName, 'Last');
  if (last) errors.lastName = last;
  const email = emailError(d.email);
  if (email) errors.email = email;
  const phone = phoneError(d.phone, { required: true });
  if (phone) errors.phone = phone;
  if (service === 'couples' && !d.partnerName) errors.partnerName = 'Please add your partner’s name';
  return errors;
}

/** True when name, email and phone are all valid, so the compact "Booking for …" row can be shown (Q3). */
export function hasCompleteContact(details: BookingDetails): boolean {
  const errors = validateDetails(details, 'individual');
  return !errors.firstName && !errors.lastName && !errors.email && !errors.phone;
}
