import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { Session } from "@/api/types";

interface SessionListProps {
  sessions: Session[];
  isLoading: boolean;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function SessionList({
  sessions,
  isLoading,
  activeSessionId,
  onSelectSession,
}: SessionListProps) {
  const [search, setSearch] = useState("");

  const filtered = search
    ? sessions.filter(
        (s) =>
          (s.repo ?? "").toLowerCase().includes(search) ||
          s.session_id.toLowerCase().includes(search) ||
          (s.agent ?? "").toLowerCase().includes(search),
      )
    : sessions;

  return (
    <>
      <div className="p-2 px-3 border-b border-border">
        <Input
          type="text"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => setSearch(e.target.value.toLowerCase())}
          className="h-8 text-xs"
        />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground font-mono">loading...</div>
        ) : !filtered.length ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {search ? "No matching sessions." : "No sessions yet."}
          </div>
        ) : (
          filtered.map((s) => (
            <button
              key={s.session_id}
              onClick={() => onSelectSession(s.session_id)}
              className={`w-full text-left px-4 py-3 border-l-2 transition-colors cursor-pointer
                ${
                  s.session_id === activeSessionId
                    ? "border-l-primary bg-accent"
                    : "border-l-transparent hover:bg-accent/50"
                }`}
            >
              <div className="font-mono text-xs text-primary truncate">
                {s.repo || s.session_id}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                <span>{s.agent || ""}</span>
                <span>{formatDate(s.latest_timestamp)}</span>
                {s.repo && (
                  <span className="font-mono text-[10px]">
                    {s.session_id.slice(0, 12)}&hellip;
                  </span>
                )}
              </div>
              <div className="flex gap-2 mt-1">
                {s.unreviewed_flags > 0 ? (
                  <Badge variant="secondary" className="text-[10px] font-mono bg-primary/10 text-primary">
                    {s.unreviewed_flags} unreviewed
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] font-mono bg-green-500/10 text-green-400">
                    reviewed
                  </Badge>
                )}
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {s.turn_count} turn{s.turn_count !== 1 ? "s" : ""}
                </Badge>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
}
