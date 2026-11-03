// Psychiatry and assessments ("clinical" sessions) are card-only: no bundle
// credits, no discount codes, no referral credit. The website enforces this in
// the browser (isClinicalCategory in BookingModal.tsx); the functions enforce
// it here so the app, or an edited request, can't get around it. Same name
// test pay-session already uses for assessments.
export function isClinicalTypeName(name: string | null | undefined): boolean {
  return /psychiatr|assessment|screening/i.test(name ?? "");
}

export const CLINICAL_CARD_ONLY_MESSAGE =
  "Psychiatry and assessment sessions can only be paid by card.";
