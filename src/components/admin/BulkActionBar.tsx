import { type RefObject, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Loader2, MoreHorizontal, Phone, PhoneOff, StickyNote, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { BulkFollowupAction, useBulkUpdateFollowups } from "@/hooks/useAdmin";
import {
  type CustomerFollowup,
  NOTE_MAX_LENGTH,
  followupErrorMessage,
} from "@/lib/customerFollowups";
import {
  appendNote,
  appendWouldOverflow,
  customersLabel,
  listNames,
  splitResults,
} from "@/lib/bulkFollowups";

type BulkUpdater = ReturnType<typeof useBulkUpdateFollowups>;

// Light text buttons on the dark bar.
const BAR_BUTTON =
  "h-8 rounded-full text-background hover:bg-background/15 hover:text-background focus-visible:ring-offset-foreground";

/**
 * Floating bar shown while customers are selected on a Progression page, with
 * the bulk actions. `selectedKeys` are always rows currently shown. After an
 * action, `onFinished` gets the keys that failed so they stay selected.
 */
export function BulkActionBar({
  selectedKeys,
  visibleCount,
  followupsByKey,
  nameByKey,
  unavailable,
  bulk,
  onClear,
  onFinished,
}: {
  selectedKeys: string[];
  visibleCount: number;
  followupsByKey: Map<string, CustomerFollowup>;
  nameByKey: Map<string, string | null>;
  unavailable: string | null;
  bulk: BulkUpdater;
  onClear: () => void;
  onFinished: (failedKeys: string[]) => void;
}) {
  const { toast } = useToast();
  const [confirmUncontact, setConfirmUncontact] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const noteButtonRef = useRef<HTMLButtonElement>(null);

  const count = selectedKeys.length;
  const saving = bulk.isPending;
  const contactedKeys = selectedKeys.filter((key) => followupsByKey.get(key)?.contacted);
  const notContactedKeys = selectedKeys.filter((key) => !followupsByKey.get(key)?.contacted);
  const nameOf = (key: string) => nameByKey.get(key) ?? "Unnamed customer";

  /** Runs the action and reports it; resolves to the keys that failed. */
  const runBulk = async (keys: string[], action: BulkFollowupAction, done: string) => {
    const results = await bulk.run({ keys, action });
    const { succeeded, failed } = splitResults(results);
    const failedKeys = failed.map((r) => r.key);
    onFinished(failedKeys);

    if (failed.length === 0) {
      toast({ title: `${done} ${customersLabel(succeeded.length)}` });
    } else {
      const reason = followupErrorMessage(failed[0].error);
      toast({
        variant: "destructive",
        title:
          succeeded.length === 0
            ? `Couldn't update ${customersLabel(failed.length)}`
            : `Updated ${succeeded.length} of ${customersLabel(keys.length)}`,
        description: `Not saved: ${listNames(failedKeys.map(nameOf))}. ${reason} ${
          failed.length === 1 ? "They're" : "These are"
        } still selected so you can try again.`,
      });
    }
    return { failedKeys, succeeded: succeeded.length, firstError: failed[0]?.error };
  };

  const markContacted = () => {
    if (saving) return;
    if (notContactedKeys.length === 0) {
      toast({ title: `All ${customersLabel(count)} are already marked as contacted` });
      return;
    }
    void runBulk(notContactedKeys, { kind: "contacted", contacted: true }, "Marked as contacted:");
  };

  const markNotContacted = () => {
    if (saving) return;
    if (contactedKeys.length === 0) {
      toast({ title: `None of the ${customersLabel(count)} are marked as contacted` });
      return;
    }
    setConfirmUncontact(true);
  };

  const actionsDisabled = Boolean(unavailable) || saving;

  return (
    <>
      {/* Centred over the page content; the sidebar takes the left on xl+. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3 xl:pl-56 2xl:pl-64">
        <div
          role="region"
          aria-label="Bulk actions for selected customers"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !saving) onClear();
          }}
          className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full bg-foreground py-1.5 pl-4 pr-1.5 text-background shadow-[var(--shadow-elevated)] animate-in fade-in slide-in-from-bottom-4"
        >
          <p className="mr-1 whitespace-nowrap text-sm font-medium" aria-live="polite">
            {saving && bulk.progress ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Saving {bulk.progress.done} of {bulk.progress.total}…
              </span>
            ) : (
              <>
                {count} selected
                <span className="hidden text-background/60 sm:inline"> of {visibleCount} shown</span>
              </>
            )}
          </p>

          <span className="mx-1 h-5 w-px bg-background/20" aria-hidden />

          {unavailable ? (
            <p className="px-2 text-xs text-background/70">{unavailable}</p>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full"
                disabled={actionsDisabled}
                onClick={markContacted}
              >
                <Phone className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Mark contacted</span>
                <span className="sm:hidden">Contacted</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={`hidden md:inline-flex ${BAR_BUTTON}`}
                disabled={actionsDisabled}
                onClick={markNotContacted}
              >
                <PhoneOff className="h-4 w-4" aria-hidden />
                Mark not contacted
              </Button>
              <Button
                ref={noteButtonRef}
                type="button"
                size="sm"
                variant="ghost"
                className={`hidden md:inline-flex ${BAR_BUTTON}`}
                disabled={actionsDisabled}
                onClick={() => setNoteOpen(true)}
              >
                <StickyNote className="h-4 w-4" aria-hidden />
                Add note
              </Button>

              {/* Narrow screens: the secondary actions fold into a menu. */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={`w-8 md:hidden ${BAR_BUTTON}`}
                    disabled={actionsDisabled}
                    aria-label="More bulk actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top">
                  <DropdownMenuItem className="gap-2" onSelect={markNotContacted}>
                    <PhoneOff className="h-4 w-4" />
                    Mark not contacted
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2" onSelect={() => setNoteOpen(true)}>
                    <StickyNote className="h-4 w-4" />
                    Add note
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={`w-8 ${BAR_BUTTON}`}
            disabled={saving}
            onClick={onClear}
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmUncontact} onOpenChange={setConfirmUncontact}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mark {customersLabel(contactedKeys.length)} as not contacted?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This clears who contacted {contactedKeys.length === 1 ? "them" : "each of them"} and
              when.
              {notContactedKeys.length > 0 &&
                ` The other ${notContactedKeys.length} selected ${
                  notContactedKeys.length === 1 ? "isn't" : "aren't"
                } marked as contacted, so ${notContactedKeys.length === 1 ? "it" : "they"} won't change.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void runBulk(
                  contactedKeys,
                  { kind: "contacted", contacted: false },
                  "Marked as not contacted:"
                )
              }
            >
              Mark {customersLabel(contactedKeys.length)} as not contacted
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkNoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        returnFocusTo={noteButtonRef}
        selectedKeys={selectedKeys}
        followupsByKey={followupsByKey}
        nameOf={nameOf}
        saving={saving}
        onSave={(text) =>
          runBulk(selectedKeys, { kind: "appendNote", text }, "Note added for")
        }
      />
    </>
  );
}

export function BulkNoteDialog({
  open,
  onOpenChange,
  returnFocusTo,
  selectedKeys,
  followupsByKey,
  nameOf,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: RefObject<HTMLButtonElement>;
  selectedKeys: string[];
  followupsByKey: Map<string, CustomerFollowup>;
  nameOf: (key: string) => string;
  saving: boolean;
  onSave: (text: string) => Promise<{ succeeded: number; firstError?: unknown }>;
}) {
  const { user } = useAuth();
  const author = user?.email ?? null;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  // Start each opening blank.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft("");
      setError(null);
    }
  }

  const count = selectedKeys.length;
  const text = draft.trim();
  const tooLong = text.length > 0 && appendNote(null, text, author).length > NOTE_MAX_LENGTH;
  const tooFull = text
    ? selectedKeys.filter((key) => appendWouldOverflow(followupsByKey.get(key)?.note, text, author))
    : [];
  const withNotes = selectedKeys.filter((key) => followupsByKey.get(key)?.note).length;

  const handleOpenChange = (next: boolean) => {
    // Keep the dialog open until an in-flight save finishes.
    if (!next && saving) return;
    onOpenChange(next);
  };

  const save = async () => {
    if (saving || !text || tooLong) return;
    setError(null);
    const { succeeded, firstError } = await onSave(text);
    // Nothing saved: stay open so the note isn't lost.
    if (succeeded === 0) {
      setError(followupErrorMessage(firstError));
    } else {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(e) => {
          // When every customer saved, the bar (and this button) is gone and
          // the page has already moved focus to the header checkbox.
          e.preventDefault();
          if (returnFocusTo.current?.isConnected) returnFocusTo.current.focus();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Add a note to {customersLabel(count)}</DialogTitle>
            <DialogDescription>
              This note will be added to every selected customer, below any note they already
              have. Existing notes are kept.
              {withNotes > 0 && ` ${withNotes} of them already ${withNotes === 1 ? "has" : "have"} a note.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Sent a follow-up email about booking a next session."
              rows={5}
              disabled={saving}
              aria-label="Note to add"
              aria-invalid={tooLong}
              aria-describedby="bulk-note-hint"
              autoFocus
            />
            <p id="bulk-note-hint" className="text-xs text-muted-foreground">
              Starts with “{appendNote(null, "", author).trim()}” so everyone can see who added it
              and when.
            </p>
            {tooLong && (
              <p className="text-xs text-destructive">
                This note is too long. Notes can be up to {NOTE_MAX_LENGTH} characters in total.
              </p>
            )}
          </div>

          {tooFull.length > 0 && !tooLong && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {listNames(tooFull.map(nameOf))} {tooFull.length === 1 ? "has" : "have"} too long a
                note to add this to, so {tooFull.length === 1 ? "that customer" : "they"} will be
                skipped and stay selected.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Couldn't add the note: {error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !text || tooLong}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Adding…" : `Add to ${customersLabel(count)}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
