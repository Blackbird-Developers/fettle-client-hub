import { useState } from 'react';
import { AlertCircle, CheckCircle, Link2, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLinkBundleCode, type LinkedBundle } from '@/hooks/useLinkBundleCode';
import { SUPPORT_EMAIL, supportMailto, type CodeProblem } from '@/lib/booking/codeProblem';
import { BUNDLE_CODE_HELP } from '@/lib/bundles';
import { cn } from '@/lib/utils';

interface AddBundleCodeProps {
  /** Called once a bundle is linked. Without it, a success line shows here. */
  onLinked?: (bundle: LinkedBundle) => void;
  /** Distinguishes the input when the form appears more than once on a page. */
  inputId?: string;
  className?: string;
}

// "Add your bundle code" form: links a bundle bought on fettle.ie (or given
// by the clinic) to the account, so clients can do it before they book. A
// refused code shows the reason and a way to contact the clinic.
export function AddBundleCode({ onLinked, inputId = 'bundleCode', className }: AddBundleCodeProps) {
  const { linkCode, isLinking } = useLinkBundleCode();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<CodeProblem | null>(null);
  const [linked, setLinked] = useState<LinkedBundle | null>(null);

  const submit = async () => {
    if (!code.trim() || isLinking) return;
    setProblem(null);
    setLinked(null);
    const result = await linkCode(code);
    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }
    setCode('');
    if (onLinked) onLinked(result.linked);
    else setLinked(result.linked);
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="space-y-2">
        <Label htmlFor={inputId}>Bundle code</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="e.g. 704E3907"
            className="uppercase"
            maxLength={32}
            autoComplete="off"
            disabled={isLinking}
          />
          <Button onClick={submit} disabled={!code.trim() || isLinking} className="gap-2 shrink-0">
            {isLinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Add code
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{BUNDLE_CODE_HELP}</p>
      </div>

      {problem && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <div className="flex gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">{problem.title}</p>
              <p className="text-sm text-muted-foreground">{problem.message}</p>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <a href={supportMailto(problem)}>
              <Mail className="h-4 w-4" />
              Email {SUPPORT_EMAIL}
            </a>
          </Button>
        </div>
      )}

      {linked && (
        <div role="status" className="rounded-lg border border-success/30 bg-success/5 p-3 flex gap-2">
          <CheckCircle className="h-4 w-4 text-success shrink-0 mt-0.5" />
          <p className="text-sm text-foreground">
            {linked.alreadyLinked ? 'Already on your account: ' : 'Added to your account: '}
            <span className="font-semibold">{linked.packageName}</span>, {linked.remainingSessions} session
            {linked.remainingSessions === 1 ? '' : 's'} left
            {linked.categoryLabel ? ` for ${linked.categoryLabel}` : ''}.
          </p>
        </div>
      )}
    </div>
  );
}
