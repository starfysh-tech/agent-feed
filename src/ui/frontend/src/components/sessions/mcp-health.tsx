import { useQuery } from "@tanstack/react-query";
import { fetchMCPHealth } from "@/api/client";
import { asString, asNumOr0 } from "@/lib/utils";
import type { OtelEvent } from "@/api/types";

interface MCPHealthProps {
  sessionId: string;
}

interface ServerLifecycle {
  scope: string;
  transport: string;
  events: OtelEvent[];
  finalStatus: string;
  hadFailure: boolean;
  errorCode?: string | null;
  totalDurationMs: number;
}


function group(events: OtelEvent[]): ServerLifecycle[] {
  // Group by (server_scope, transport_type) — these are the only stable
  // identifiers in mcp_server_connection events; the connection itself
  // doesn't carry a unique server name.
  const map = new Map<string, ServerLifecycle>();
  for (const e of events) {
    const scope = asString(e.attributes.server_scope);
    const transport = asString(e.attributes.transport_type);
    const key = `${scope}|${transport}`;
    if (!map.has(key)) {
      map.set(key, {
        scope,
        transport,
        events: [],
        finalStatus: "",
        hadFailure: false,
        errorCode: null,
        totalDurationMs: 0,
      });
    }
    const lc = map.get(key)!;
    lc.events.push(e);
    const status = asString(e.attributes.status);
    lc.finalStatus = status;
    if (status === "failed") {
      lc.hadFailure = true;
      lc.errorCode = asString(e.attributes.error_code) || null;
    }
    lc.totalDurationMs += asNumOr0(e.attributes.duration_ms);
  }
  return Array.from(map.values());
}

export function MCPHealth({ sessionId }: MCPHealthProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["mcp-health", sessionId],
    queryFn: () => fetchMCPHealth(sessionId),
  });

  if (isLoading) return <div className="font-mono text-xs text-muted-foreground p-4">loading mcp health...</div>;
  if (error) return <div className="font-mono text-xs text-red-500 p-4">{(error as Error).message}</div>;
  if (!data || data.length === 0) return null;

  const servers = group(data);

  return (
    <div className="space-y-2 font-mono text-xs">
      <h3 className="text-sm font-medium text-foreground">MCP servers ({servers.length})</h3>
      <div className="rounded border border-border p-3 space-y-1">
        {servers.map((s, i) => (
          <div key={i} className="flex items-center gap-3">
            <span
              className={
                s.hadFailure
                  ? "text-red-500"
                  : s.finalStatus === "connected"
                    ? "text-emerald-500"
                    : "text-muted-foreground"
              }
            >
              {s.hadFailure ? "✗" : s.finalStatus === "connected" ? "●" : "○"}
            </span>
            <span className="text-foreground font-medium">
              {s.scope}/{s.transport}
            </span>
            <span className="text-muted-foreground">{s.finalStatus}</span>
            {s.errorCode && <span className="text-red-500">{s.errorCode}</span>}
            <span className="text-muted-foreground">{s.totalDurationMs}ms total</span>
          </div>
        ))}
      </div>
    </div>
  );
}
