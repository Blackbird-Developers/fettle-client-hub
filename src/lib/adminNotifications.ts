// Notifications for staff, shown under the bell on every admin page. Written
// by edge functions only (see the admin_notifications migration); admins can
// read them and mark them read.

export interface AdminNotification {
  id: string;
  created_at: string;
  kind: string;
  title: string;
  body: string | null;
  client_email: string | null;
  client_name: string | null;
  details: unknown;
  read_at: string | null;
  read_by_email: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Extra facts to show under a notification, as "Label: value" lines. Only
 * the ones staff need to sort the problem out; empty values are skipped.
 */
export function notificationDetailLines(n: Pick<AdminNotification, 'kind' | 'details'>): string[] {
  const d = asRecord(n.details);
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    lines.push(`${label}: ${String(value)}`);
  };

  if (n.kind === 'bundle_code_refused') {
    add('Code', d.code);
    add('Bundle email in Acuity', d.certificateEmail);
    add('Session type tried', d.appointmentTypeID ? `Acuity type ${d.appointmentTypeID}` : null);
    add('Expires', d.expiration);
    if (Array.isArray(d.acuityErrors) && d.acuityErrors.length > 0) {
      add('Acuity said', d.acuityErrors.join(' · '));
    }
  }
  return lines;
}

export function unreadCount(rows: Pick<AdminNotification, 'read_at'>[] | undefined): number {
  return rows ? rows.filter((r) => !r.read_at).length : 0;
}
