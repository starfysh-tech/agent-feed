import { useQuery } from "@tanstack/react-query";
import { fetchHookActivity } from "@/api/client";
import { asNumOr0, asString } from "@/lib/utils";

interface HookActivityProps {
  sessionId: string;
}

export function HookActivity({ sessionId }: HookActivityProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hook-activity", sessionId],
    queryFn: () => fetchHookActivity(sessionId),
  });

  if (isLoading) return <div className="font-mono text-xs text-muted-foreground p-4">loading hook activity...</div>;
  if (error) return <div className="font-mono text-xs text-red-500 p-4">{(error as Error).message}</div>;
  if (!data || data.length === 0) return null;

  // Show only completion events to avoid duplicating start/complete pairs
  const completions = data.filter((e) => e.event_name.endsWith("hook_execution_complete"));

  return (
    <div className="space-y-2 font-mono text-xs">
      <h3 className="text-sm font-medium text-foreground">Hook activity ({completions.length})</h3>
      <div className="rounded border border-border p-3 space-y-1">
        {completions.map((e) => {
          const blocking = asNumOr0(e.attributes.num_blocking);
          const cancelled = asNumOr0(e.attributes.num_cancelled);
          const errors = asNumOr0(e.attributes.num_non_blocking_error);
          const success = asNumOr0(e.attributes.num_success);
          const total = blocking + cancelled + errors + success;
          const hasIssue = blocking > 0 || cancelled > 0 || errors > 0;
          return (
            <div key={e.id} className="flex items-center gap-3">
              <span className={hasIssue ? "text-amber-500" : "text-emerald-500"}>
                {hasIssue ? "!" : "✓"}
              </span>
              <span className="text-foreground font-medium">{asString(e.attributes.hook_event)}</span>
              <span className="text-muted-foreground">
                {success}/{total} ok
                {blocking > 0 && ` · ${blocking} blocking`}
                {cancelled > 0 && ` · ${cancelled} cancelled`}
                {errors > 0 && ` · ${errors} errors`}
              </span>
              <span className="text-muted-foreground">{asNumOr0(e.attributes.total_duration_ms)}ms</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
