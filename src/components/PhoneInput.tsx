import { useEffect, useRef, useState } from "react";
import type { CountryCode } from "libphonenumber-js";
import { Check, ChevronDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import {
  PHONE_COUNTRIES,
  dialCode,
  joinPhone,
  localPlaceholder,
  splitPhone,
} from "@/lib/contactValidation";

interface PhoneInputProps {
  id: string;
  /** Stored value: one international string, e.g. "+353 87 123 4567". */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  selectClassName?: string;
  inputClassName?: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}

/** cmdk value per country: what the search box matches against. */
const countryValue = (c: (typeof PHONE_COUNTRIES)[number]) =>
  `${c.name} ${c.short} ${dialCode(c.code)}`;

/**
 * Country prefix dropdown plus the local number. The parent only ever sees the
 * combined international value, so every form keeps storing one phone field.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  onBlur,
  selectClassName,
  inputClassName,
  className,
  invalid,
  describedBy,
  autoFocus,
}: PhoneInputProps) {
  const [country, setCountry] = useState<CountryCode>(
    () => splitPhone(value).country,
  );
  const [local, setLocal] = useState(() => splitPhone(value).local);
  const lastEmitted = useRef(value);
  const [open, setOpen] = useState(false);
  const localRef = useRef<HTMLInputElement>(null);
  const focusLocalOnClose = useRef(false);

  // A value set from outside (e.g. the number from an earlier booking) re-splits the fields.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const next = splitPhone(value, country);
    setCountry(next.country);
    setLocal(next.local);
  }, [value, country]);

  const selected =
    PHONE_COUNTRIES.find((c) => c.code === country) ?? PHONE_COUNTRIES[0];

  const emit = (c: CountryCode, l: string) => {
    const joined = joinPhone(c, l);
    lastEmitted.current = joined;
    onChange(joined);
  };

  return (
    <div className={cn("flex gap-2", className)}>
      {/* A styled list rather than the browser's own <select> menu, so the
          open list matches the form. The closed box keeps a short label
          ("🇮🇪 IRL +353") so the country is easy to read. */}
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={`Country code: ${selected.name} ${dialCode(selected.code)}`}
            aria-haspopup="listbox"
            className={cn(
              "phone-prefix flex shrink-0 items-center gap-1.5 whitespace-nowrap text-left",
              selectClassName,
            )}
            style={{ width: "auto" }}
          >
            <span aria-hidden="true">{selected.flag}</span>
            <span>
              {selected.short} {dialCode(selected.code)}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0 opacity-60 transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            // After picking a country, carry on in the number box, not back on the button.
            onCloseAutoFocus={(e) => {
              if (!focusLocalOnClose.current) return;
              focusLocalOnClose.current = false;
              e.preventDefault();
              localRef.current?.focus();
            }}
            align="start"
            sideOffset={6}
            className="z-50 w-72 overflow-hidden rounded-xl border border-border bg-card p-0 font-body text-foreground shadow-elevated outline-none"
          >
            <Command
              className="bg-card"
              defaultValue={countryValue(selected)}
              filter={(itemValue, search) =>
                itemValue.toLowerCase().includes(search.toLowerCase().trim())
                  ? 1
                  : 0
              }
            >
              <CommandInput
                placeholder="Search country or code"
                className="text-[15px]"
              />
              {/* Inside a booking dialog the page scroll is locked; keep wheel and
                touch scrolling working in this list, which sits outside it. */}
              <CommandList
                className="max-h-72 overscroll-contain p-1.5"
                onWheel={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
              >
                <CommandEmpty className="py-5 text-center text-sm text-muted-foreground">
                  No country found
                </CommandEmpty>
                <CommandGroup className="p-0">
                  {PHONE_COUNTRIES.map((c) => (
                    <CommandItem
                      key={c.code}
                      value={countryValue(c)}
                      onSelect={() => {
                        setCountry(c.code);
                        emit(c.code, local);
                        setOpen(false);
                        focusLocalOnClose.current = true;
                      }}
                      className={cn(
                        "cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-[15px] text-foreground",
                        "data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground",
                        c.code === country && "font-semibold",
                      )}
                    >
                      <span aria-hidden="true">{c.flag}</span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-muted-foreground">
                        {dialCode(c.code)}
                      </span>
                      <Check
                        aria-hidden="true"
                        className={cn(
                          "h-4 w-4 shrink-0 text-primary",
                          c.code === country ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <input
        ref={localRef}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        autoFocus={autoFocus}
        className={cn("min-w-0 flex-1", inputClassName)}
        placeholder={localPlaceholder(country)}
        value={local}
        maxLength={20}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onBlur={onBlur}
        onChange={(e) => {
          const l = e.target.value;
          // A pasted "+44 …" number switches the dropdown to match.
          if (/^(\+|00)\d/.test(l.trim())) {
            const next = splitPhone(l, country);
            setCountry(next.country);
            setLocal(next.local);
            emit(next.country, next.local);
            return;
          }
          setLocal(l);
          emit(country, l);
        }}
      />
    </div>
  );
}
