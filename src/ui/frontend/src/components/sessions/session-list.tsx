import type { Session } from "@/api/types";

interface SessionListProps {
  sessions: Session[];
  isLoading: boolean;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function SessionList({ sessions, isLoading, activeSessionId, onSelectSession }: SessionListProps) {
  if (isLoading) return <div className="p-4 text-xs text-muted-foreground font-mono">loading...</div>;
  if (!sessions.length) return <div className="p-6 text-center text-sm text-muted-foreground">No sessions yet.</div>;
  return (
    <div className="py-1">
      {sessions.map((s) => (
        <button key={s.session_id} onClick={() => onSelectSession(s.session_id)}
          className={`w-full text-left px-4 py-3 border-l-2 transition-colors ${s.session_id === activeSessionId ? "border-l-primary bg-accent" : "border-l-transparent hover:bg-accent/50"}`}>
          <div className="font-mono text-xs text-primary truncate">{s.repo || s.session_id}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2"><span>{s.agent}</span></div>
        </button>
      ))}
    </div>
  );
}
