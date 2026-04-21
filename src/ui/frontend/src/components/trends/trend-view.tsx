import { useTrends } from "@/hooks/use-trends";
import { getFlagColors } from "@/lib/utils";

interface TrendViewProps {
  agent?: string;
  dateFrom?: string;
  onSelectSession: (id: string) => void;
}

export function TrendView({ agent, dateFrom, onSelectSession }: TrendViewProps) {
  const { data, isLoading, error } = useTrends({ agent, dateFrom });

  if (isLoading) return <div className="p-10 text-center font-mono text-xs text-muted-foreground">loading trends...</div>;
  if (error || !data) return <div className="p-10 text-center text-sm text-muted-foreground">Failed to load trends.</div>;

  const maxCount = Math.max(...data.by_type.map((t) => t.count), 1);

  return (
    <div>
      <div className="mb-5 pb-4 border-b border-border">
        <h1 className="text-base font-semibold">Trends</h1>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          {data.total_flags} total flags across {data.by_session.length} sessions
        </p>
      </div>

      <div className="mb-5">
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-2">By Type</div>
        {data.by_type.length > 0 ? (
          data.by_type.map((t) => {
            const pct = Math.round((t.count / maxCount) * 100);
            const fpPct = Math.round(t.false_positive_rate * 100);
            const colors = getFlagColors(t.type);
            return (
              <div key={t.type} className="flex items-center gap-2 mb-1.5">
                <span className={`font-mono text-[11px] w-24 shrink-0 ${colors.text}`}>{t.type}</span>
                <div className="flex-1 bg-muted rounded-sm h-2 overflow-hidden">
                  <div className="h-full rounded-sm transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: `var(--color-flag-${t.type}, var(--primary))` }} />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground w-7 text-right">{t.count}</span>
                <span className="font-mono text-[10px] text-red-400 w-9 text-right">{fpPct > 0 ? `${fpPct}%fp` : ""}</span>
              </div>
            );
          })
        ) : (
          <div className="text-xs text-muted-foreground">No flags yet</div>
        )}
      </div>

      <div>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-2">By Session</div>
        {data.by_session.length > 0 ? (
          data.by_session.map((s) => (
            <button key={s.session_id} onClick={() => onSelectSession(s.session_id)}
              className="w-full py-2 border-b border-border/50 cursor-pointer flex justify-between items-center transition-colors hover:text-primary">
              <span className="font-mono text-[11px] text-primary truncate max-w-[200px]">{s.repo || s.session_id}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{s.flag_count ?? 0} flags</span>
            </button>
          ))
        ) : (
          <div className="text-xs text-muted-foreground">No sessions yet</div>
        )}
      </div>
    </div>
  );
}
