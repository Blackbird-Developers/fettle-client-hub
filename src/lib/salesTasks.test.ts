import { describe, expect, it } from "vitest";
import { salesTask } from "@/test/salesTaskFixture";
import {
  carriedOverLabel,
  countDueTasks,
  dueLabel,
  groupTasks,
  matchesTaskSearch,
  priorityReasons,
  sourceHref,
  taskState,
} from "./salesTasks";

const TODAY = "2026-10-16";

describe("groupTasks", () => {
  it("keeps completed and auto-closed tasks out of the active lists", () => {
    const groups = groupTasks(
      [
        salesTask({ customer_name: "Open" }),
        salesTask({ customer_name: "Done", status: "completed", completed_at: "2026-10-16T09:00:00Z" }),
        salesTask({ customer_name: "Closed", status: "auto_closed", completed_at: "2026-10-16T05:30:00Z" }),
      ],
      TODAY
    );
    expect(groups.today.map((t) => t.customer_name)).toEqual(["Open"]);
    expect(groups.upcoming).toEqual([]);
  });

  it("puts overdue and today's tasks in Today, most important first, and later ones in Scheduled", () => {
    const groups = groupTasks(
      [
        salesTask({ customer_name: "Medium", priority: "medium", score: 50 }),
        salesTask({ customer_name: "High today", priority: "high", score: 90 }),
        salesTask({ customer_name: "High carried", priority: "high", score: 75, due_on: "2026-10-14", carried_over_count: 2 }),
        salesTask({ customer_name: "Next week", due_on: "2026-10-23" }),
        salesTask({ customer_name: "Tomorrow", due_on: "2026-10-17" }),
      ],
      TODAY
    );
    expect(groups.today.map((t) => t.customer_name)).toEqual(["High carried", "High today", "Medium"]);
    expect(groups.upcoming.map((t) => t.customer_name)).toEqual(["Tomorrow", "Next week"]);
  });
});

describe("labels", () => {
  it("names the task state", () => {
    expect(taskState(salesTask(), TODAY)).toBe("pending");
    expect(taskState(salesTask({ due_on: "2026-10-15" }), TODAY)).toBe("overdue");
    expect(taskState(salesTask({ due_on: "2026-10-20" }), TODAY)).toBe("upcoming");
    expect(taskState(salesTask({ status: "completed", due_on: "2026-10-01" }), TODAY)).toBe("completed");
  });

  it("describes the due date", () => {
    expect(dueLabel({ due_on: TODAY }, TODAY)).toBe("Due today");
    expect(dueLabel({ due_on: "2026-10-15" }, TODAY)).toBe("Overdue by 1 day");
    expect(dueLabel({ due_on: "2026-10-13" }, TODAY)).toBe("Overdue by 3 days");
    expect(dueLabel({ due_on: "2026-10-17" }, TODAY)).toBe("Tomorrow");
    expect(dueLabel({ due_on: "2026-10-20" }, TODAY)).toBe("In 4 days");
  });

  it("marks carried-over tasks", () => {
    expect(carriedOverLabel({ carried_over_count: 0 })).toBeNull();
    expect(carriedOverLabel({ carried_over_count: 1 })).toBe("Carried over 1 day");
    expect(carriedOverLabel({ carried_over_count: 3 })).toBe("Carried over 3 days");
  });

  it("reads saved priority reasons and skips malformed ones", () => {
    expect(
      priorityReasons({ priority_reasons: [{ label: "Quoted", points: 25 }, { label: 3 }, "x", null] })
    ).toEqual([{ label: "Quoted", points: 25 }]);
    expect(priorityReasons({ priority_reasons: {} })).toEqual([]);
  });
});

describe("links, counts and search", () => {
  it("links to the source page, searched for the customer", () => {
    expect(sourceHref(salesTask())).toBe("/admin/leads?q=aoife%40example.com");
    expect(sourceHref(salesTask({ kind: "psychiatry", customer_email: null }))).toBe(
      "/admin/psychiatry?q=087%20123%204567"
    );
    expect(sourceHref(salesTask({ kind: "assessment", customer_email: null, customer_phone: null, customer_name: null }))).toBe(
      "/admin/assessments"
    );
  });

  it("counts open tasks due today or earlier for the badge", () => {
    expect(
      countDueTasks(
        [
          salesTask(),
          salesTask({ due_on: "2026-10-10" }),
          salesTask({ due_on: "2026-10-20" }),
          salesTask({ status: "completed" }),
        ],
        TODAY
      )
    ).toBe(2);
  });

  it("searches name, email, phone digits and service", () => {
    const task = salesTask();
    expect(matchesTaskSearch(task, "aoife")).toBe(true);
    expect(matchesTaskSearch(task, "0871234")).toBe(true);
    expect(matchesTaskSearch(task, "finding your path")).toBe(true);
    expect(matchesTaskSearch(task, "seán")).toBe(false);
  });
});
