import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatDate, cn } from "@/lib/utils";
import type { Session } from "@/api/types";

interface SessionListProps {
  sessions: Session[];
  isLoading: boolean;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

function shortModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/-20\d{6}$/, "")
    .replace("gemini-", "")
    .replace("-preview", "");
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
          (s.agent ?? "").toLowerCase().includes(search) ||
          (s.model ?? "").toLowerCase().includes(search),
      )
    : sessions;

  return (
    <>
      <div className="p-1.5 px-2 border-b border-border">
        <Input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value.toLowerCase())}
          className="h-6 text-[10px]"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 text-[10px] text-muted-foreground font-mono">loading...</div>
        ) : !filtered.length ? (
          <div className="p-4 text-center text-[10px] text-muted-foreground">
            {search ? "No matches." : "No sessions."}
          </div>
        ) : (
          filtered.map((s) => (
            <button
              key={s.session_id}
              onClick={() => onSelectSession(s.session_id)}
              className={cn(
                "w-full text-left px-3 py-2 transition-colors cursor-pointer border-b border-border/50",
                s.session_id === activeSessionId
                  ? "bg-accent"
                  : "hover:bg-accent/40",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] text-foreground truncate">{s.repo || "unknown"}</span>
                {s.unreviewed_flags > 0 ? (
                  <span className="font-mono text-[9px] text-primary bg-primary/15 px-1.5 rounded-sm shrink-0">
                    {s.unreviewed_flags}
                  </span>
                ) : (
                  <span className="text-[9px] text-emerald-500 font-mono shrink-0">&#10003;</span>
                )}
              </div>
              <div className="font-mono text-[9px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <span>{shortModel(s.model)}</span>
                <span>·</span>
                <span>{formatDate(s.latest_timestamp)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
}
