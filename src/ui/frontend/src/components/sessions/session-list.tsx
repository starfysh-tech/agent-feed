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
          (s.agent ?? "").toLowerCase().includes(search) ||
          (s.model ?? "").toLowerCase().includes(search),
      )
    : sessions;

  // Group by repo to show repo headers only when it changes
  let lastRepo: string | null = null;

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
          filtered.map((s) => {
            const showRepoHeader = s.repo !== lastRepo;
            lastRepo = s.repo;
            const shortModel = (s.model ?? "").replace(/^claude-/, "").replace(/-20\d{6}$/, "");

            return (
              <div key={s.session_id}>
                {showRepoHeader && s.repo && (
                  <div className="px-4 pt-3 pb-1 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                    {s.repo}
                  </div>
                )}
                <button
                  onClick={() => onSelectSession(s.session_id)}
                  className={`w-full text-left px-4 py-2 transition-colors cursor-pointer
                    ${
                      s.session_id === activeSessionId
                        ? "bg-accent"
                        : "hover:bg-accent/50"
                    }`}
                >
                  {/* Primary line: date + model */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-foreground">
                      {formatDate(s.latest_timestamp)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground truncate">
                      {shortModel}
                    </span>
                  </div>
                  {/* Secondary line: agent + badges */}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted-foreground font-mono">{s.agent}</span>
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {s.turn_count} turn{s.turn_count !== 1 ? "s" : ""}
                    </span>
                    {s.unreviewed_flags > 0 ? (
                      <Badge variant="secondary" className="text-[9px] font-mono bg-primary/10 text-primary ml-auto px-1.5 py-0">
                        {s.unreviewed_flags}
                      </Badge>
                    ) : (
                      <span className="ml-auto text-[10px] text-emerald-500 font-mono">&#10003;</span>
                    )}
                  </div>
                </button>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
