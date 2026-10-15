import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AlertTriangle, CalendarX, Search } from "lucide-react";
import { BADGE_STYLES, type BadgeTone } from "@/lib/clinicalDisplay";

// Shared by the admin Psychiatry and Assessments pages.

export function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <Badge variant="outline" className={`whitespace-nowrap ${BADGE_STYLES[tone]}`}>
      {label}
    </Badge>
  );
}

export function TabToggle<T extends string>({
  tabs,
  value,
  counts,
  onChange,
  label,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  counts: Record<T, number>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      className="flex-wrap justify-start"
      aria-label={label}
    >
      {tabs.map((tab) => (
        <ToggleGroupItem key={tab.id} value={tab.id} variant="outline" size="sm">
          {tab.label} ({counts[tab.id]})
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Search box plus a filter by Acuity calendar (shown when there's more than one). */
export function SearchAndCalendarFilter({
  search,
  onSearch,
  calendar,
  onCalendar,
  calendars,
  allLabel,
}: {
  search: string;
  onSearch: (value: string) => void;
  calendar: string;
  onCalendar: (value: string) => void;
  calendars: string[];
  allLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name, email or phone"
          className="pl-8"
          aria-label="Search clients"
        />
      </div>
      {calendars.length > 1 && (
        <Select value={calendar} onValueChange={onCalendar}>
          <SelectTrigger className="w-[200px]" aria-label="Filter by calendar">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{allLabel}</SelectItem>
            {calendars.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export function EmptyRows({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
      <CalendarX className="h-8 w-8" />
      <p className="text-sm">{filtered ? "No clients match your search or filters." : "No clients here."}</p>
    </div>
  );
}

export function DataIssues({ items }: { items: ReactNode[] }) {
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <Alert className="border-amber-200 bg-amber-50/50">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle>Data to be aware of</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
          {shown.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
