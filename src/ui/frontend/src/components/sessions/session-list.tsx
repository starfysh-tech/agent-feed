import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Session } from "@/api/types";

interface SessionListProps {
  sessions: Session[];
  isLoading: boolean;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

interface RepoGroup {
  repo: string;
  sessions: Session[];
  totalUnreviewed: number;
}

export function SessionList({
  sessions,
  isLoading,
  activeSessionId,
  onSelectSession,
}: SessionListProps) {
  const [search, setSearch] = useState("");
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);

  // Group sessions by repo
  const groups = useMemo(() => {
    const filtered = search
      ? sessions.filter(
          (s) =>
            (s.repo ?? "").toLowerCase().includes(search) ||
            s.session_id.toLowerCase().includes(search) ||
            (s.agent ?? "").toLowerCase().includes(search) ||
            (s.model ?? "").toLowerCase().includes(search),
        )
      : sessions;

    const map = new Map<string, Session[]>();
    for (const s of filtered) {
      const key = s.repo || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }

    const result: RepoGroup[] = [];
    for (const [repo, repoSessions] of map) {
      result.push({
        repo,
        sessions: repoSessions,
        totalUnreviewed: repoSessions.reduce((sum, s) => sum + s.unreviewed_flags, 0),
      });
    }
    // Sort: repos with unreviewed flags first, then by latest timestamp
    result.sort((a, b) => {
      if (a.totalUnreviewed > 0 && b.totalUnreviewed === 0) return -1;
      if (a.totalUnreviewed === 0 && b.totalUnreviewed > 0) return 1;
      const aLatest = a.sessions[0]?.latest_timestamp ?? "";
      const bLatest = b.sessions[0]?.latest_timestamp ?? "";
      return bLatest.localeCompare(aLatest);
    });
    return result;
  }, [sessions, search]);

  // Auto-expand the repo containing the active session
  const activeRepo = sessions.find((s) => s.session_id === activeSessionId)?.repo ?? null;
  const effectiveExpanded = expandedRepo ?? activeRepo;

  return (
    <>
      <div className="p-2 px-3 border-b border-border">
        <Input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value.toLowerCase())}
          className="h-7 text-[10px]"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground font-mono">loading...</div>
        ) : !groups.length ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {search ? "No matches." : "No sessions yet."}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.repo}>
              {/* Repo header — clickable to expand/collapse */}
              <button
                onClick={() => setExpandedRepo(effectiveExpanded === g.repo ? null : g.repo)}
                className={cn(
                  "w-full text-left px-4 py-2.5 flex items-center justify-between cursor-pointer transition-colors",
                  effectiveExpanded === g.repo ? "bg-accent/50" : "hover:bg-accent/30",
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {effectiveExpanded === g.repo ? "▾" : "▸"}
                  </span>
                  <span className="text-xs font-medium text-foreground truncate">{g.repo}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {g.sessions.length}
                  </span>
                </div>
                {g.totalUnreviewed > 0 && (
                  <Badge variant="secondary" className="text-[9px] font-mono bg-primary/15 text-primary px-1.5 py-0 shrink-0">
                    {g.totalUnreviewed}
                  </Badge>
                )}
              </button>

              {/* Sessions — shown when repo is expanded */}
              {effectiveExpanded === g.repo && (
                <div className="bg-background/50">
                  {g.sessions.map((s) => {
                    const shortModel = (s.model ?? "").replace(/^claude-/, "").replace(/-20\d{6}$/, "");
                    return (
                      <button
                        key={s.session_id}
                        onClick={() => onSelectSession(s.session_id)}
                        className={cn(
                          "w-full text-left pl-8 pr-4 py-2 transition-colors cursor-pointer",
                          s.session_id === activeSessionId
                            ? "bg-accent"
                            : "hover:bg-accent/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-foreground">
                            {formatDate(s.latest_timestamp)}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {shortModel}
                            </span>
                            {s.unreviewed_flags > 0 ? (
                              <Badge variant="secondary" className="text-[9px] font-mono bg-primary/10 text-primary px-1.5 py-0">
                                {s.unreviewed_flags}
                              </Badge>
                            ) : (
                              <span className="text-[10px] text-emerald-500 font-mono">&#10003;</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-muted-foreground font-mono">{s.agent}</span>
                          <span className="text-[10px] text-muted-foreground">·</span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {s.turn_count} turn{s.turn_count !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
