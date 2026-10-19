import type { SalesTask } from "@/lib/salesTasks";

const TODAY = "2026-10-16";

// A pending hot-lead task due 16 Oct 2026; tests override what they need.
let nextId = 1;
export function salesTask(overrides: Partial<SalesTask> = {}): SalesTask {
  return {
    id: String(nextId++),
    dedupe_key: `hot_lead|email:a${nextId}@x.ie|2026-10-15T10:00:00.000Z`,
    customer_key: `email:a${nextId}@x.ie`,
    kind: "hot_lead",
    customer_name: "Aoife Byrne",
    customer_email: "aoife@example.com",
    customer_phone: "087 123 4567",
    trigger_at: "2026-10-15T10:00:00Z",
    service_type: "Let's Talk - Finding your Path",
    owner: "Courtney",
    lead_status: "open",
    reason: "Quoted yesterday and hasn't booked since",
    priority_reasons: [{ label: "Quoted", points: 25 }],
    next_action: "Call to follow up on the quote",
    status: "pending",
    priority: "high",
    score: 80,
    created_at: "2026-10-16T05:30:00Z",
    created_on: TODAY,
    priority_at_creation: "high",
    score_at_creation: 80,
    original_due_on: TODAY,
    due_on: TODAY,
    carried_over_count: 0,
    last_carried_on: null,
    completed_at: null,
    completed_by: null,
    completed_by_email: null,
    priority_at_completion: null,
    score_at_completion: null,
    seconds_to_complete: null,
    closed_reason: null,
    updated_at: "2026-10-16T05:30:00Z",
    ...overrides,
  };
}
