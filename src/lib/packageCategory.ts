// Session category a bundle belongs to. A bundle's credits may only be
// redeemed against sessions of the same category (a youth bundle can't pay for
// an individual session, etc.).
export type PackageCategory = 'individual' | 'youth' | 'couples';

// Maps each bundle's Acuity product ID to its session category.
//
// This MUST stay in sync with:
//   - the PACKAGES array in PackageBookingModal.tsx
//   - the PACKAGE_CATEGORY maps in supabase/functions/confirm-package-payment,
//     verify-package-payment, sync-acuity-packages, and book-with-package
const PACKAGE_CATEGORY_BY_ID: Record<string, PackageCategory> = {
  '1122832': 'individual', // 3 Session Bundle
  '996385': 'individual',  // 6 Session Bundle
  '1197875': 'individual', // 9 Session Bundle
  '1370588': 'youth',      // Youth Bundle 3 x 60min
  '1975510': 'youth',      // Youth Bundle 5 x 60min
  '2000708': 'couples',    // Couples 3 x 60 min
  '1967869': 'couples',    // Couples 5 x 60 min
};

// Returns the session category for a bundle's Acuity product ID, or undefined
// for an unrecognised ID.
export function getPackageCategory(
  packageId: string | number | null | undefined
): PackageCategory | undefined {
  if (packageId === null || packageId === undefined) return undefined;
  return PACKAGE_CATEGORY_BY_ID[String(packageId)];
}
