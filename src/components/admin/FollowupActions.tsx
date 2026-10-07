import { type RefObject, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, Check, Loader2, MoreHorizontal, Phone, PhoneOff, StickyNote } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUpdateFollowup } from "@/hooks/useAdmin";
import { formatDateTime } from "@/lib/customerInsights";
import {
  type CustomerFollowup,
  NOTE_MAX_LENGTH,
  followupErrorMessage,
  normalizeNote,
  noteChanged,
  validateNote,
} from "@/lib/customerFollowups";

const byLine = (email: string | null, at: string | null) =>
  [email && `by ${email}`, at && `on ${formatDateTime(at)}`].filter(Boolean).join(" ");

/**
 * Follow-up cell on the Progression pages: contacted status, note icon and a
 * `…` menu for this customer. Bulk changes go through the selection bar.
 * `unavailable` (follow-ups failed to load) disables the actions with the reason.
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
  const contactMutation = useUpdateFollowup();
  const [noteOpen, setNoteOpen] = useState(false);
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Where focus goes back to when the note dialog closes.
  const [noteOpenedFrom, setNoteOpenedFrom] = useState<RefObject<HTMLButtonElement>>(noteButtonRef);

  const name = customerName ?? "customer";
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
            description: followupErrorMessage(error),
            variant: "destructive",
          }),
      }
    );
  };

  const openNote = (from: RefObject<HTMLButtonElement>) => {
    setNoteOpenedFrom(from);
    setNoteOpen(true);
  };

  const contactedBy = byLine(followup?.contacted_by_email ?? null, followup?.contacted_at ?? null);

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        {/* Badge doesn't forward refs, so the span is the tooltip anchor. */}
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Badge
              variant="outline"
              className={`cursor-default whitespace-nowrap gap-1 ${
                contacted
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "text-muted-foreground"
              }`}
            >
              {contactMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : contacted ? (
                <Check className="h-3 w-3" />
              ) : null}
              {contacted ? "Contacted" : "Not contacted"}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {unavailable ??
            (contacted
              ? `Contacted${contactedBy ? ` ${contactedBy}` : ""}`
              : "Not contacted yet")}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          {/* span keeps the tooltip working while the button is disabled */}
          <span tabIndex={unavailable ? 0 : -1}>
            <Button
              ref={noteButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${hasNote ? "text-amber-700 hover:text-amber-800" : "text-muted-foreground"}`}
              aria-label={hasNote ? `Edit note for ${name}` : `Add note for ${name}`}
              disabled={Boolean(unavailable)}
              onClick={() => openNote(noteButtonRef)}
            >
              <StickyNote className="h-4 w-4" fill={hasNote ? "currentColor" : "none"} fillOpacity={0.2} />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-line">
          {unavailable ?? (hasNote ? followup?.note : "Add a note")}
        </TooltipContent>
      </Tooltip>

      {/* Non-modal so the note dialog can open straight from a menu item. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={menuButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            aria-label={`More actions for ${name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {unavailable && (
            <>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {unavailable}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            className="gap-2"
            disabled={Boolean(unavailable) || contactMutation.isPending}
            onSelect={toggleContacted}
          >
            {contacted ? <PhoneOff className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
            {contacted ? "Mark as not contacted" : "Mark as contacted"}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            disabled={Boolean(unavailable)}
            onSelect={() => openNote(menuButtonRef)}
          >
            <StickyNote className="h-4 w-4" />
            {hasNote ? "Edit note" : "Add note"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        returnFocusTo={noteOpenedFrom}
        customerKey={customerKey}
        customerName={customerName}
        followup={followup}
      />
    </div>
  );
}

function NoteDialog({
  open,
  onOpenChange,
  returnFocusTo,
  customerKey,
  customerName,
  followup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: RefObject<HTMLButtonElement>;
  customerKey: string;
  customerName: string | null;
  followup: CustomerFollowup | undefined;
}) {
  const { toast } = useToast();
  const noteMutation = useUpdateFollowup();
  const [draft, setDraft] = useState("");
  const [wasOpen, setWasOpen] = useState(false);

  const saved = followup?.note ?? null;
  // Start each opening from the saved note.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(saved ?? "");
      noteMutation.reset();
    }
  }

  const validation = validateNote(draft);
  const changed = noteChanged(saved, draft);
  const saving = noteMutation.isPending;

  const handleOpenChange = (next: boolean) => {
    // Keep the dialog open until an in-flight save finishes.
    if (!next && saving) return;
    onOpenChange(next);
  };

  const save = () => {
    if (saving || validation || !changed) return;
    noteMutation.mutate(
      { customerKey, patch: { note: normalizeNote(draft) } },
      {
        onSuccess: (row) => {
          onOpenChange(false);
          toast({
            title: row.note ? "Note saved" : "Note cleared",
            description: customerName ?? undefined,
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
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
                Couldn't save the note: {followupErrorMessage(noteMutation.error)}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
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
  );
}
