import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { bundleProblem, type CodeProblem } from '@/lib/booking/codeProblem';

/** A bundle redeem-package-code linked (or found already linked) to the account. */
export interface LinkedBundle {
  packageId: string | null;
  packageName: string;
  remainingSessions: number;
  categoryLabel: string | null;
  alreadyLinked: boolean;
}

export type LinkBundleResult = { linked: LinkedBundle } | { problem: CodeProblem };

/** Codes are typed with spaces or lower case; Acuity's are upper case. */
export function normaliseBundleCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

// Links a bundle code bought on fettle.ie (or issued by the clinic) to the
// signed-in account outside a booking: the Packages modal and the dashboard.
// The booking modal has its own flow (BookingModal.handleBundleCodeDetected)
// because it also switches the booking over to a credit.
export function useLinkBundleCode() {
  const queryClient = useQueryClient();
  const [isLinking, setIsLinking] = useState(false);

  const linkCode = async (rawCode: string): Promise<LinkBundleResult> => {
    const code = normaliseBundleCode(rawCode);
    setIsLinking(true);
    try {
      const { data, error } = await supabase.functions.invoke('redeem-package-code', {
        body: { code },
      });
      if (error) {
        // Non-2xx: use the function's own reason and message when there is one.
        let body: { reason?: string; message?: string } | null = null;
        try {
          body = await (error as { context?: Response }).context?.json();
        } catch {
          /* keep the default message */
        }
        return {
          problem: bundleProblem(code, {
            reason: body?.reason || 'server_error',
            message: body?.message,
          }),
        };
      }
      if (!data?.ok) return { problem: bundleProblem(code, data) };

      await queryClient.invalidateQueries({ queryKey: ['user-packages'] });
      return {
        linked: {
          packageId: data.package?.id ?? null,
          packageName: data.packageName || 'Session bundle',
          remainingSessions: data.remainingSessions ?? 0,
          categoryLabel: data.categoryLabel ?? null,
          alreadyLinked: !!data.alreadyLinked,
        },
      };
    } catch {
      return { problem: bundleProblem(code, { reason: 'server_error' }) };
    } finally {
      setIsLinking(false);
    }
  };

  return { linkCode, isLinking };
}
