import { useState } from "react";
import { format, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Date range filter shared by the admin Feedback and Activity log pages.
// Days are "yyyy-MM-dd" strings; "" means not set.


const DAY_FORMAT = "yyyy-MM-dd";

/** Label for the date button, e.g. "1 Oct – 13 Oct 2026". */
function dateRangeLabel(from: string, to: string): string | null {
  if (!from && !to) return null;
  const show = (day: string, withYear: boolean) => format(parseISO(day), withYear ? "d MMM yyyy" : "d MMM");
  if (from && to) {
    if (from === to) return show(from, true);
    return `${show(from, from.slice(0, 4) !== to.slice(0, 4))} – ${show(to, true)}`;
  }
  return from ? `From ${show(from, true)}` : `Until ${show(to, true)}`;
}

// Smaller cells and spacing than the default calendar, for a filter popover.
const COMPACT_CALENDAR = {
  month: "space-y-2",
  caption: "flex justify-center pt-0.5 relative items-center",
  nav_button: "inline-flex h-6 w-6 items-center justify-center rounded-md border border-input opacity-60 hover:opacity-100",
  head_cell: "text-muted-foreground rounded-md w-8 font-normal text-[0.7rem]",
  row: "flex w-full mt-1",
  // No background on the cell itself: only the days in between get a band,
  // so a lone start/end day is a clean rounded square.
  cell: "h-8 w-8 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
  day: "inline-flex h-8 w-8 items-center justify-center rounded-md p-0 text-sm font-normal hover:bg-accent hover:text-accent-foreground aria-selected:opacity-100",
  day_range_middle: "rounded-none aria-selected:bg-accent aria-selected:text-accent-foreground",
  // Today isn't highlighted; only the chosen dates are.
  day_today: "",
};

/** Date range picker using the hub's calendar, in a popover. */
export function DateRangeFilter({
  id,
  from,
  to,
  onChange,
}: {
  id: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected: DateRange | undefined = from
    ? { from: parseISO(from), to: to ? parseISO(to) : undefined }
    : undefined;
  const label = dateRangeLabel(from, to);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn("w-[240px] justify-start font-normal", !label && "text-muted-foreground")}
        >
          <CalendarDays className="mr-2 h-4 w-4" />
          {label ?? "Any date"}
        </Button>
      </PopoverTrigger>
      {/* Always opens below the button, even near the bottom of the window
          (the page scrolls instead). */}
      <PopoverContent className="w-auto p-0" align="start" side="bottom" avoidCollisions={false}>
        {/* w-0 min-w-full: the header takes the calendar's width instead of
            stretching the popover, so there's no gap beside the calendar. */}
        <div className="flex w-0 min-w-full items-center justify-between gap-2 border-b px-3 py-1.5 text-xs">
          <span className="font-medium" aria-live="polite">
            {from && !to ? "Now pick an end date" : (label ?? "Pick a start and end date")}
          </span>
          {label && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => {
                onChange("", "");
                setOpen(false);
              }}
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
        <Calendar
          mode="range"
          selected={selected}
          defaultMonth={selected?.from}
          onSelect={(range) => {
            onChange(
              range?.from ? format(range.from, DAY_FORMAT) : "",
              range?.to ? format(range.to, DAY_FORMAT) : ""
            );
            if (range?.to) setOpen(false);
          }}
          disabled={{ after: new Date() }}
          weekStartsOn={1}
          numberOfMonths={1}
          initialFocus
          className="p-2"
          classNames={COMPACT_CALENDAR}
        />
      </PopoverContent>
    </Popover>
  );
}
