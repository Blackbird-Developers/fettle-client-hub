import { AnalyticsBoards } from "./analytics/AnalyticsBoards";

// Admin Overview: the Progression and Customers analytics boards. The
// Follow-ups, Revenue, Sessions and Engagement summaries were removed at
// Fettle's request (the Follow-ups report has its own page).
export function AdminDashboard() {
  return (
    <div className="space-y-6 animate-fade-in">
      <AnalyticsBoards />
    </div>
  );
}
