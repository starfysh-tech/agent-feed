import { useMemo, useState } from "react";
import { Shell } from "@/components/layout/shell";
import { SessionList } from "@/components/sessions/session-list";
import { SessionDetail } from "@/components/sessions/session-detail";
import { TrendView } from "@/components/trends/trend-view";
import { useSessions } from "@/hooks/use-sessions";

function getDefaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export default function App() {
  const [view, setView] = useState("sessions");
  const [selectedModel, setSelectedModel] = useState("all");
  const [dateFrom, setDateFrom] = useState(getDefaultDateFrom);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Fetch all sessions (no agent filter — model filter is client-side)
  const { data: allSessions = [], isLoading: sessionsLoading } = useSessions(undefined, dateFrom);

  // Extract unique models from loaded sessions
  const models = useMemo(() => {
    const set = new Set<string>();
    for (const s of allSessions) {
      if (s.model && s.model !== "unknown") set.add(s.model);
    }
    return [...set].sort();
  }, [allSessions]);

  // Sessions are not filtered by model — model filter applies to turns within a session
  const sessions = allSessions;

  const sidebar = view === "sessions" ? (
    <SessionList
      sessions={sessions}
      isLoading={sessionsLoading}
      activeSessionId={activeSessionId}
      dateFrom={dateFrom}
      onDateChange={setDateFrom}
      onSelectSession={(id) => {
        setActiveSessionId(id);
        setView("sessions");
      }}
    />
  ) : null;

  const mainContent = view === "trends" ? (
    <TrendView agent={undefined} dateFrom={dateFrom} onSelectSession={(id) => {
      setActiveSessionId(id);
      setView("sessions");
    }} />
  ) : activeSessionId ? (
    <SessionDetail sessionId={activeSessionId} modelFilter={selectedModel === "all" ? undefined : selectedModel} />
  ) : (
    <EmptyState />
  );

  return (
    <Shell
      currentView={view}
      onViewChange={setView}
      models={models}
      selectedModel={selectedModel}
      onModelChange={setSelectedModel}
      sidebar={sidebar}
    >
      {mainContent}
    </Shell>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20 text-muted-foreground">
      <p className="text-[15px] text-foreground mb-2">No session selected</p>
      <p className="text-sm">
        Select a session from the sidebar to review
        <br />
        decisions, assumptions, and architectural choices.
      </p>
    </div>
  );
}
