// Last good response of each Acuity-backed admin request, kept so reloading
// an admin page shows data straight away while fresh data loads.
//
// The responses hold client names, emails and phone numbers, so they go in
// sessionStorage (this tab only, wiped when it closes), are tied to the admin
// who loaded them, and are cleared on sign-out (see AuthContext).

import type { AdminDataSource } from "./adminLoadProgress";

// Bump when a response shape changes so old saved copies are ignored.
const KEY_PREFIX = "fettle-admin-data:v1:";

interface CachedEntry<T> {
  userId: string;
  savedAt: number;
  data: T;
}

export function readCachedAdminData<T>(
  source: AdminDataSource,
  userId: string | undefined
): { data: T; savedAt: number } | undefined {
  if (!userId) return undefined;
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + source);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CachedEntry<T>;
    if (entry?.userId !== userId || typeof entry.savedAt !== "number" || entry.data == null) {
      return undefined;
    }
    return { data: entry.data, savedAt: entry.savedAt };
  } catch {
    return undefined;
  }
}

export function writeCachedAdminData<T>(
  source: AdminDataSource,
  userId: string | undefined,
  data: T,
  savedAt: number = Date.now()
): void {
  if (!userId) return;
  try {
    const entry: CachedEntry<T> = { userId, savedAt, data };
    sessionStorage.setItem(KEY_PREFIX + source, JSON.stringify(entry));
  } catch {
    // Storage blocked or full — the page still works, just without the instant reload.
  }
}

export function clearCachedAdminData(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Storage blocked — nothing was saved.
  }
}
