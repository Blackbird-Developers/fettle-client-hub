import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

interface TourStep {
  target: string;
  title: string;
  description: string;
  placement: "top" | "bottom";
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="referral-code"]',
    title: "Your unique referral code",
    description:
      "This is your personal code. Tap Copy and drop it into any message — WhatsApp, iMessage, wherever you chat.",
    placement: "bottom",
  },
  {
    target: '[data-tour="referral-link"]',
    title: "Or share your full link",
    description:
      "Your link does the same job. Anyone who signs up through it is credited to you automatically.",
    placement: "bottom",
  },
  {
    target: '[data-tour="share-buttons"]',
    title: "One-tap sharing",
    description:
      "Hit WhatsApp to send a pre-written message, or Email to drop it into your inbox. The Share button works for anything else.",
    placement: "top",
  },
  {
    target: '[data-tour="stats"]',
    title: "Track your earnings",
    description:
      "See how many friends have joined, your available credit, and any pending invites — all updated in real time.",
    placement: "bottom",
  },
];

const PADDING = 10;
const TOOLTIP_W = 300;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
}

function measureRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom };
}

function tooltipStyle(rect: Rect, placement: "top" | "bottom"): React.CSSProperties {
  const centreX = rect.left + rect.width / 2;
  const left = Math.max(12, Math.min(centreX - TOOLTIP_W / 2, window.innerWidth - TOOLTIP_W - 12));
  if (placement === "bottom") {
    return { top: rect.bottom + PADDING + 8, left };
  }
  return { top: rect.top - PADDING - 8 - 172, left };
}

interface ReferralTourProps {
  onClose: () => void;
}

export function ReferralTour({ onClose }: ReferralTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const current = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  useEffect(() => {
    const el = document.querySelector(current.target);
    if (!el) return;

    // 1. Measure immediately — spotlight appears with zero delay
    setRect(measureRect(current.target));

    // 2. Scroll the element into view
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // 3. Track in real-time via RAF while the page is scrolling so the
    //    spotlight follows the element instead of jumping at the end
    let rafId: number;
    const track = () => {
      setRect(measureRect(current.target));
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);

    // Stop after 700 ms — scroll animation should be fully settled by then
    const stop = setTimeout(() => cancelAnimationFrame(rafId), 700);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(stop);
    };
  }, [stepIndex, current.target]);

  // Re-measure on window resize
  useEffect(() => {
    const onResize = () => setRect(measureRect(current.target));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [current.target]);

  const next = () => {
    if (isLast) { onClose(); return; }
    setStepIndex((i) => i + 1);
  };
  const back = () => setStepIndex((i) => i - 1);

  if (!rect) return null;

  const spotlightStyle: React.CSSProperties = {
    position: "fixed",
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
    borderRadius: 14,
    // The large box-shadow darkens everything outside this element
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.58)",
    pointerEvents: "none",
    zIndex: 49,
  };

  const ttStyle: React.CSSProperties = {
    ...tooltipStyle(rect, current.placement),
    position: "fixed",
    width: TOOLTIP_W,
    zIndex: 51,
  };

  return createPortal(
    <>
      {/* Spotlight */}
      <div style={spotlightStyle} />

      {/* Tooltip card */}
      <div
        style={ttStyle}
        className="rounded-2xl border border-border/60 bg-background shadow-elevated p-4 animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Step counter + close */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {stepIndex + 1} / {STEPS.length}
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label="Close tour"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Arrow pointer toward the highlighted element */}
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 w-0 h-0",
            current.placement === "bottom"
              ? "-top-2 border-l-[8px] border-r-[8px] border-b-[8px] border-l-transparent border-r-transparent border-b-background"
              : "-bottom-2 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-background"
          )}
        />

        <p className="font-heading font-semibold text-sm text-foreground mb-1">
          {current.title}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed mb-4">
          {current.description}
        </p>

        {/* Dot indicators */}
        <div className="flex items-center gap-1.5 mb-4">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "rounded-full transition-all duration-200",
                i === stepIndex ? "w-4 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-muted-foreground/30"
              )}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {stepIndex > 0 && (
            <Button variant="outline" size="sm" className="gap-1" onClick={back}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          )}
          <Button
            size="sm"
            className={cn("gap-1.5 shadow-sm", stepIndex === 0 && "w-full")}
            onClick={next}
          >
            {isLast ? "Done!" : (
              <>
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </>,
    document.body
  );
}
