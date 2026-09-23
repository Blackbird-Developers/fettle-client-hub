import type { PackageCategory } from '@/lib/packageCategory';

// Session bundles sold in the hub. Each is an Acuity product; the id is the
// Acuity product ID. This MUST stay in sync with packageCategory.ts and the
// PACKAGE_CATEGORY maps in the package edge functions.
//
// Acuity links:
// Individual 3: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1122832
// Individual 6: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=996385
// Individual 9: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1197875
// Youth 3: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1370588
// Youth 5: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1975510
// Couples 3: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=2000708
// Couples 5: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1967869

export interface SessionBundle {
  id: number;
  category: PackageCategory;
  name: string;
  sessions: number;
  sessionDuration: number;
  price: number;
  individualPrice: number;
  savings: number;
  popular: boolean;
}

export const SESSION_BUNDLES: SessionBundle[] = [
  {
    id: 1122832,
    category: 'individual',
    name: "3 Session Bundle",
    sessions: 3,
    sessionDuration: 50,
    price: 271.50,
    individualPrice: 95,
    savings: 13.50,
    popular: false
  },
  {
    id: 996385,
    category: 'individual',
    name: "6 Session Bundle",
    sessions: 6,
    sessionDuration: 50,
    price: 528,
    individualPrice: 95,
    savings: 42,
    popular: true
  },
  {
    id: 1197875,
    category: 'individual',
    name: "9 Session Bundle",
    sessions: 9,
    sessionDuration: 50,
    price: 765,
    individualPrice: 95,
    savings: 90,
    popular: false
  },
  {
    id: 1370588,
    category: 'youth',
    name: "Youth Bundle 3 x 60min",
    sessions: 3,
    sessionDuration: 60,
    price: 325,
    individualPrice: 125,
    savings: 50,
    popular: false
  },
  {
    id: 1975510,
    category: 'youth',
    name: "Youth Bundle 5 x 60min",
    sessions: 5,
    sessionDuration: 60,
    price: 550,
    individualPrice: 125,
    savings: 75,
    popular: true
  },
  {
    id: 2000708,
    category: 'couples',
    name: "Couples 3 x 60 min",
    sessions: 3,
    sessionDuration: 60,
    price: 345,
    individualPrice: 135,
    savings: 60,
    popular: false
  },
  {
    id: 1967869,
    category: 'couples',
    name: "Couples 5 x 60 min",
    sessions: 5,
    sessionDuration: 60,
    price: 575,
    individualPrice: 135,
    savings: 100,
    popular: true
  },
];

/** Euro amount for display: "€528", "€271.50", "€13.50". */
export function formatEuro(amount: number): string {
  const cents = Math.round(amount * 100);
  return cents % 100 === 0 ? `€${cents / 100}` : `€${(cents / 100).toFixed(2)}`;
}

export function getSessionBundle(id: number | null | undefined): SessionBundle | undefined {
  if (!id) return undefined;
  return SESSION_BUNDLES.find((bundle) => bundle.id === id);
}

/** The bundle of a given size for a category, e.g. 6 individual sessions. */
export function findSessionBundle(
  category: PackageCategory,
  sessions: number
): SessionBundle | undefined {
  return SESSION_BUNDLES.find(
    (bundle) => bundle.category === category && bundle.sessions === sessions
  );
}
