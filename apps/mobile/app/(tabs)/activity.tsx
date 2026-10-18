import { EmptyState } from "@/components/EmptyState";

/** Activity placeholder: reading/listening time tracking lands in Phase 10. */
export default function ActivityScreen() {
  return (
    <EmptyState
      title="Activity"
      message="Daily, weekly, and monthly reading and listening time will appear here."
    />
  );
}
