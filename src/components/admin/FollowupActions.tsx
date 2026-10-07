import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, Check, Loader2, Phone, StickyNote } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUpdateFollowup } from "@/hooks/useAdmin";
import { formatDateTime } from "@/lib/customerInsights";
import {
  type CustomerFollowup,
  NOTE_MAX_LENGTH,
  normalizeNote,
  noteChanged,
  validateNote,
} from "@/lib/customerFollowups";

// Supabase errors are plain objects with a message, not Error instances.
const errorMessage = (error: unknown) => {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : "Please try again.";
};

const byLine = (email: string | null, at: string | null) =>
  [email && `by ${email}`, at && `on ${formatDateTime(at)}`].filter(Boolean).join(" ");

/**
 * Actions cell on the Progression pages: contacted toggle + note.
 * `unavailable` (follow-ups failed to load) disables both with the reason.
 */
export function FollowupActions({
  customerKey,
  customerName,
  followup,
  unavailable,
}: {
  customerKey: string;
  customerName: string | null;
  followup: CustomerFollowup | undefined;
  unavailable: string | null;
}) {
  const { toast } = useToast();
  // One mutation per row and per action, so pending state is per button.
  const contactMutation = useUpdateFollowup();
  const contacted = followup?.contacted ?? false;
  const hasNote = Boolean(followup?.note);

  const toggleContacted = () => {
    if (contactMutation.isPending) return;
    contactMutation.mutate(
      { customerKey, patch: { contacted: !contacted } },
      {
        onSuccess: (saved) =>
          toast({
            title: saved.contacted ? "Marked as contacted" : "Marked as not contacted",
            description: customerName ?? undefined,
          }),
        onError: (error) =>
          toast({
            title: "Couldn't update contact status",
            description: errorMessage(error),
            variant: "destructive",
          }),
      }
    );
  };

  const contactedBy = byLine(followup?.contacted_by_email ?? null, followup?.contacted_at ?? null);
  const contactHint =
    unavailable ??
    (contacted
      ? `Contacted${contactedBy ? ` ${contactedBy}` : ""}. Click to undo.`
      : "Mark this customer as contacted");

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span keeps the tooltip working while the button is disabled */}
          <span tabIndex={unavailable ? 0 : -1}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={contacted}
              disabled={Boolean(unavailable) || contactMutation.isPending}
              onClick={toggleContacted}
              className={
                contacted
                  ? "whitespace-nowrap bg-green-50 text-green-700 border-green-200 hover:bg-green-100 hover:text-green-800"
                  : "whitespace-nowrap"
              }
            >
              {contactMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : contacted ? (
                <Check className="h-4 w-4" />
              ) : (
                <Phone className="h-4 w-4" />
              )}
              {contacted ? "Contacted" : "Not contacted"}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{contactHint}</TooltipContent>
      </Tooltip>

      <NoteButton
        customerKey={customerKey}
        customerName={customerName}
        followup={followup}
        hasNote={hasNote}
        unavailable={unavailable}
      />
    </div>
  );
}

function NoteButton({
  customerKey,
  customerName,
  followup,
  hasNote,
  unavailable,
}: {
  customerKey: string;
  customerName: string | null;
  followup: CustomerFollowup | undefined;
  hasNote: boolean;
  unavailable: string | null;
}) {
  const { toast } = useToast();
  const noteMutation = useUpdateFollowup();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const saved = followup?.note ?? null;
  const validation = validateNote(draft);
  const changed = noteChanged(saved, draft);
  const saving = noteMutation.isPending;

  const openDialog = () => {
    setDraft(saved ?? "");
    noteMutation.reset();
    setOpen(true);
  };

  const onOpenChange = (next: boolean) => {
    // Keep the dialog open until an in-flight save finishes.
    if (!next && saving) return;
    setOpen(next);
  };

  const save = () => {
    if (saving || validation || !changed) return;
    noteMutation.mutate(
      { customerKey, patch: { note: normalizeNote(draft) } },
      {
        onSuccess: (row) => {
          setOpen(false);
          toast({
            title: row.note ? "Note saved" : "Note cleared",
            description: customerName ?? undefined,
          });
        },
      }
    );
  };

  const label = unavailable ?? (hasNote ? "View or edit note" : "Add a note");

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={unavailable ? 0 : -1}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={`h-9 w-9 ${hasNote ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 hover:text-amber-800" : ""}`}
              aria-label={hasNote ? `Edit note for ${customerName ?? "customer"}` : `Add note for ${customerName ?? "customer"}`}
              disabled={Boolean(unavailable)}
              onClick={openDialog}
            >
              <StickyNote className="h-4 w-4" fill={hasNote ? "currentColor" : "none"} fillOpacity={0.2} />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-line">
          {hasNote && !unavailable ? saved : label}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Note for {customerName ?? "this customer"}</DialogTitle>
              <DialogDescription>
                Only Fettle staff with admin access can see this.
                {followup?.note_updated_at &&
                  ` Last edited ${byLine(followup.note_updated_by_email, followup.note_updated_at)}.`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. Called 7 Oct, left a voicemail. Try again Friday."
                rows={6}
                disabled={saving}
                aria-label="Note"
                aria-invalid={Boolean(validation)}
                autoFocus
              />
              <div className="flex justify-between gap-2 text-xs">
                <span className="text-destructive">{validation}</span>
                <span
                  className={
                    (normalizeNote(draft)?.length ?? 0) > NOTE_MAX_LENGTH
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {normalizeNote(draft)?.length ?? 0}/{NOTE_MAX_LENGTH}
                </span>
              </div>
            </div>

            {noteMutation.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Couldn't save the note: {errorMessage(noteMutation.error)}
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || Boolean(validation) || !changed}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
