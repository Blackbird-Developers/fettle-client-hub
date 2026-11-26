import { useState } from "react";
import { format } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  type DateRangeValue,
  COMPARE_PRESETS,
  type ComparePresetId,
  DATE_PRESETS,
  type DatePresetId,
  type DayRange,
  clampToMin,
  compareRange,
  formatDay,
  formatDayRange,
  isDay,
  orderedRange,
  presetRange,
  rangeWithin,
} from "@/lib/datePresets";

// The admin pages' date picker: presets down the left, a two-month calendar
// on the right, and an optional second period to compare against.
// Changes are only passed on when Apply is pressed.

export type { DateRangeValue };

type Target = "range" | "compare";

interface Draft {
  preset: DatePresetId;
  range: DayRange;
  compareOn: boolean;
  comparePreset: ComparePresetId;
  compareRange: DayRange;
  /** Which period calendar clicks set. */
  target: Target;
  /** First day clicked while picking a period on the calendar. */
  anchor: string | null;
}

const ALL_PRESETS = DATE_PRESETS.map((preset) => preset.id);

const toDate = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const toDay = (date: Date) => format(date, "yyyy-MM-dd");
const monthOf = (day: string) => toDate(`${day.slice(0, 7)}-01`);

function draftFrom(value: DateRangeValue): Draft {
  return {
    preset: value.preset,
    range: value.range,
    compareOn: value.compare !== null,
    comparePreset: value.compare?.preset ?? "previous",
    compareRange: value.compare?.range ?? compareRange(value.range, "previous")!,
    target: "range",
    anchor: null,
  };
}

/** Recomputes a preset compare period after the main period changes. */
function withCompare(draft: Draft): Draft {
  const range = compareRange(draft.range, draft.comparePreset);
  return range ? { ...draft, compareRange: range } : draft;
}

// One look per calendar day; overlapping roles resolve to a single one so
// their colours never fight.
type DayRole = "rangeEnd" | "compareEnd" | "both" | "rangeMiddle" | "compareMiddle" | null;

function dayRole(day: string, range: DayRange, compare: DayRange | null): DayRole {
  const inRange = day >= range.from && day <= range.to;
  const inCompare = !!compare && day >= compare.from && day <= compare.to;
  if (day === range.from || day === range.to) return "rangeEnd";
  if (compare && (day === compare.from || day === compare.to)) return "compareEnd";
  if (inRange && inCompare) return "both";
  if (inRange) return "rangeMiddle";
  if (inCompare) return "compareMiddle";
  return null;
}

const ROLE_CLASSES: Record<Exclude<DayRole, null>, string> = {
  rangeEnd: "!bg-primary !text-primary-foreground font-medium hover:!bg-primary/90",
  compareEnd: "!bg-secondary-foreground !text-secondary font-medium hover:!bg-secondary-foreground/90",
  both: "rounded-none !bg-primary/15 shadow-[inset_0_-3px_0_hsl(var(--secondary-foreground))]",
  rangeMiddle: "rounded-none !bg-primary/15 text-foreground",
  compareMiddle: "rounded-none !bg-secondary text-secondary-foreground",
};

// The hub's calendar, with the selection colours handled by DayRole instead.
const CALENDAR_CLASSES = {
  months: "flex flex-col gap-4 sm:flex-row sm:gap-6",
  month: "space-y-3",
  caption: "flex justify-center pt-1 relative items-center",
  caption_label: "text-sm font-heading font-semibold",
  head_cell: "text-muted-foreground w-9 font-normal text-[0.75rem]",
  row: "flex w-full mt-1",
  cell: "h-9 w-9 p-0 text-center text-sm relative focus-within:relative focus-within:z-20",
  day: "inline-flex h-9 w-9 items-center justify-center rounded-md p-0 text-sm font-normal transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  day_today: "underline decoration-primary decoration-2 underline-offset-4",
  day_disabled: "text-muted-foreground opacity-40 hover:bg-transparent",
  day_outside: "invisible",
};

/** A start and end date box for one period. */
function PeriodFields({
  label,
  range,
  active,
  swatch,
  min,
  max,
  onFocus,
  onChange,
}: {
  label: string;
  range: DayRange;
  active: boolean;
  swatch: string;
  min?: string;
  max?: string;
  onFocus: () => void;
  onChange: (range: DayRange) => void;
}) {
  const field = (which: keyof DayRange) => (
    <input
      type="date"
      aria-label={`${label} ${which === "from" ? "start" : "end"} date`}
      value={range[which]}
      min={min}
      max={max}
      onFocus={onFocus}
      onChange={(e) => {
        const day = e.target.value;
        if (!isDay(day)) return;
        const other = which === "from" ? range.to : range.from;
        onChange(orderedRange(day, other));
      }}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border bg-background px-2.5 text-sm sm:w-[9.5rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary/60" : "border-input"
      )}
    />
  );

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground sm:w-20">
        <span className={cn("h-2.5 w-2.5 rounded-full", swatch)} aria-hidden />
        {label}
      </span>
      <div className="flex items-center gap-2">
        {field("from")}
        <span className="text-muted-foreground" aria-hidden>
          –
        </span>
        {field("to")}
      </div>
    </div>
  );
}

/** A list option on the left of the picker. */
function OptionButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "w-full rounded-md px-3 py-1 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

/** What the closed picker's button says. */
function triggerLabel(value: DateRangeValue): string {
  const preset = DATE_PRESETS.find((option) => option.id === value.preset);
  return preset ? preset.label : formatDayRange(value.range);
}

export function DateRangePicker({
  id,
  value,
  onChange,
  today = toDay(new Date()),
  min,
  compareMin,
  max = today,
  presets = ALL_PRESETS,
  clampPresets = false,
  allowCompare = true,
  className,
}: {
  id?: string;
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  /** "yyyy-MM-dd"; defaults to the browser's today. */
  today?: string;
  /** Earliest day that can be picked. */
  min?: string;
  /** Earliest comparison day; defaults to the main period's minimum. */
  compareMin?: string;
  /** Latest day that can be picked; defaults to today. */
  max?: string;
  /** The presets on offer, in DATE_PRESETS order. */
  presets?: readonly DatePresetId[];
  /** Start presets that reach back before `min` on `min` instead of hiding
   *  them ("This year" from the first day with figures). */
  clampPresets?: boolean;
  allowCompare?: boolean;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(value));
  const [hovered, setHovered] = useState<string | null>(null);
  // The calendar's first month; the second month shows the range's end.
  const [month, setMonth] = useState(() => monthOf(value.range.to));

  const showMonthsFor = (range: DayRange) => {
    const end = monthOf(range.to);
    setMonth(isMobile ? end : new Date(end.getFullYear(), end.getMonth() - 1, 1));
  };

  const onOpenChange = (next: boolean) => {
    if (next) {
      const fresh = draftFrom(value);
      setDraft(fresh);
      setHovered(null);
      showMonthsFor(fresh.range);
    }
    setOpen(next);
  };

  /** A preset's days, or null when it can't be offered. */
  const presetDays = (preset: DatePresetId): DayRange | null => {
    const range = presetRange(preset, today);
    const days = range && clampPresets ? clampToMin(range, min) : range;
    return days && rangeWithin(days, min, max) ? days : null;
  };

  const offeredPresets = DATE_PRESETS.filter((preset) => presets.includes(preset.id) && presetDays(preset.id));

  const choosePreset = (preset: DatePresetId) => {
    const range = presetDays(preset)!;
    setDraft((current) => withCompare({ ...current, preset, range, target: "range", anchor: null }));
    showMonthsFor(range);
  };

  const setRange = (range: DayRange) =>
    setDraft((current) => withCompare({ ...current, preset: "custom", range, anchor: null }));

  const setCompare = (range: DayRange) =>
    setDraft((current) => ({ ...current, comparePreset: "custom", compareRange: range, anchor: null }));

  const chooseComparePreset = (preset: ComparePresetId) =>
    setDraft((current) =>
      withCompare({
        ...current,
        comparePreset: preset,
        // Custom: the calendar now sets the compare period.
        target: preset === "custom" ? "compare" : "range",
        anchor: null,
      })
    );

  const onDayClick = (date: Date) => {
    const day = toDay(date);
    setDraft((current) => {
      const range = current.anchor ? orderedRange(current.anchor, day) : { from: day, to: day };
      const anchor = current.anchor ? null : day;
      if (current.target === "compare") {
        return { ...current, comparePreset: "custom", compareRange: range, anchor };
      }
      return withCompare({ ...current, preset: "custom", range, anchor });
    });
  };

  // While picking, the period stretches to the day under the pointer.
  const preview = draft.anchor && hovered ? orderedRange(draft.anchor, hovered) : null;
  const shownRange = draft.target === "range" && preview ? preview : draft.range;
  const shownCompare = draft.compareOn ? (draft.target === "compare" && preview ? preview : draft.compareRange) : null;
  const roleOf = (date: Date) => dayRole(toDay(date), shownRange, shownCompare);

  const apply = () => {
    onChange({
      preset: draft.preset,
      range: draft.range,
      compare: draft.compareOn ? { preset: draft.comparePreset, range: draft.compareRange } : null,
    });
    setOpen(false);
  };

  // Comparisons may reach back further than the main period (compareMin).
  const compareStart = compareMin ?? min;
  const compareBeforeMin = draft.compareOn && !!compareStart && draft.compareRange.from < compareStart;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn("h-auto min-h-10 justify-start gap-2 py-1.5 text-left font-normal hover:bg-muted hover:text-foreground", className)}
        >
          <CalendarDays className="text-muted-foreground" />
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-medium">{triggerLabel(value)}</span>
            <span className="text-xs text-muted-foreground">
              {value.preset === "custom" ? null : `${formatDayRange(value.range)}`}
              {value.compare && (
                <>
                  {value.preset === "custom" ? "" : " · "}vs {formatDayRange(value.compare.range)}
                </>
              )}
            </span>
          </span>
          <ChevronDown className="ml-auto text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl p-0 shadow-lg"
        collisionPadding={8}
        // Keep focus on the button instead of ringing the first preset;
        // Tab still moves into the picker.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex flex-col sm:flex-row">
          {/* Presets, then compare */}
          <div className="flex flex-col border-b sm:w-56 sm:border-b-0 sm:border-r">
            {/* On wider screens the list fills the height beside the calendar
                (grow from a 0px basis, so it never makes the picker taller) and scrolls past that. */}
            <div className="max-h-44 space-y-0.5 overflow-y-auto p-2 sm:max-h-none sm:min-h-0 sm:grow sm:basis-0" aria-label="Date presets" role="group">
              <OptionButton selected={draft.preset === "custom"} onClick={() => setDraft((c) => ({ ...c, preset: "custom", target: "range" }))}>
                Custom
              </OptionButton>
              {offeredPresets.map((preset) => (
                <OptionButton key={preset.id} selected={draft.preset === preset.id} onClick={() => choosePreset(preset.id)}>
                  {preset.label}
                </OptionButton>
              ))}
            </div>
            {allowCompare && (
              <div className="border-t p-2">
                <label className="flex cursor-pointer items-center justify-between rounded-md px-3 py-1.5 text-sm font-medium">
                  Compare
                  <Switch
                    checked={draft.compareOn}
                    onCheckedChange={(compareOn) =>
                      setDraft((current) => withCompare({ ...current, compareOn, target: "range", anchor: null }))
                    }
                  />
                </label>
                {draft.compareOn && (
                  <div className="mt-1 space-y-0.5" role="group" aria-label="Compare with">
                    {COMPARE_PRESETS.map((preset) => (
                      <OptionButton
                        key={preset.id}
                        selected={draft.comparePreset === preset.id}
                        onClick={() => chooseComparePreset(preset.id)}
                      >
                        {preset.label}
                      </OptionButton>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Dates and calendar */}
          <div className="flex flex-col">
            <div className="space-y-2 border-b p-3">
              <PeriodFields
                label="Dates"
                range={draft.range}
                active={draft.target === "range"}
                swatch="bg-primary"
                min={min}
                max={max}
                onFocus={() => setDraft((c) => ({ ...c, target: "range", anchor: null }))}
                onChange={setRange}
              />
              {draft.compareOn && (
                <PeriodFields
                  label="Compare"
                  range={draft.compareRange}
                  active={draft.target === "compare"}
                  swatch="bg-secondary-foreground"
                  min={compareMin ?? min}
                  max={max}
                  onFocus={() => setDraft((c) => ({ ...c, target: "compare", anchor: null }))}
                  onChange={setCompare}
                />
              )}
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {draft.anchor
                  ? "Now pick an end date"
                  : draft.compareOn
                    ? `Clicking the calendar sets the ${draft.target === "range" ? "dates" : "compare period"}. Click a date box to switch.`
                    : "Click a start date, then an end date."}
              </p>
            </div>
            <Calendar
              month={month}
              onMonthChange={setMonth}
              numberOfMonths={isMobile ? 1 : 2}
              weekStartsOn={1}
              showOutsideDays={false}
              fromDate={(draft.target === "compare" ? compareMin ?? min : min) ? toDate((draft.target === "compare" ? compareMin ?? min : min)!) : undefined}
              toDate={max ? toDate(max) : undefined}
              onDayClick={(date, modifiers) => !modifiers.disabled && onDayClick(date)}
              onDayMouseEnter={(date) => setHovered(toDay(date))}
              onDayMouseLeave={() => setHovered(null)}
              modifiers={{
                rangeEnd: (date) => roleOf(date) === "rangeEnd",
                compareEnd: (date) => roleOf(date) === "compareEnd",
                both: (date) => roleOf(date) === "both",
                rangeMiddle: (date) => roleOf(date) === "rangeMiddle",
                compareMiddle: (date) => roleOf(date) === "compareMiddle",
              }}
              modifiersClassNames={ROLE_CLASSES}
              className="p-3"
              classNames={CALENDAR_CLASSES}
            />
            <div className="flex items-center justify-between gap-3 border-t p-3">
              <p className="text-xs text-muted-foreground">
                {compareBeforeMin ? `Figures start on ${formatDay(compareStart!)}, so part of the compare period is empty.` : ""}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={apply} disabled={!!draft.anchor}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
