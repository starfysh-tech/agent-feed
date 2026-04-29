import { useQuery } from "@tanstack/react-query";
import { fetchToolDecisions } from "@/api/client";
import { asStringOrNull, asNumOrNull } from "@/lib/utils";
import type { OtelEvent } from "@/api/types";

interface ToolDecisionTimelineProps {
  sessionId: string;
}

interface DecisionRow {
  toolUseId: string | null;
  toolName: string;
  decision: string;
  decisionSource: string;
  promptId: string | null;
  sequence: number | null;
  result: { success: boolean | null; durationMs: number | null; sizeBytes: number | null } | null;
}

function pairUp(decisions: OtelEvent[], results: OtelEvent[]): DecisionRow[] {
  // Pair by tool_use_id when present; otherwise by tool_name + nearest sequence
  const resultByTuid = new Map<string, OtelEvent>();
  const resultsByTool = new Map<string, OtelEvent[]>();
  for (const r of results) {
    const tuid = asStringOrNull(r.attributes.tool_use_id);
    if (tuid) resultByTuid.set(tuid, r);
    const tn = asStringOrNull(r.attributes.tool_name) ?? "";
    if (!resultsByTool.has(tn)) resultsByTool.set(tn, []);
    resultsByTool.get(tn)!.push(r);
  }

  return decisions.map((d) => {
    const tuid = asStringOrNull(d.attributes.tool_use_id);
    const tn = asStringOrNull(d.attributes.tool_name) ?? "?";
    let result: OtelEvent | undefined;
    if (tuid && resultByTuid.has(tuid)) result = resultByTuid.get(tuid)!;
    else {
      const candidates = resultsByTool.get(tn) ?? [];
      result = candidates.find((r) => (r.sequence ?? 0) > (d.sequence ?? 0));
    }
    return {
      toolUseId: tuid,
      toolName: tn,
      decision: asStringOrNull(d.attributes.decision) ?? "?",
      decisionSource: asStringOrNull(d.attributes.source) ?? "?",
      promptId: d.prompt_id,
      sequence: d.sequence,
      result: result
        ? {
            success: result.attributes.success === "true" || result.attributes.success === true,
            durationMs: asNumOrNull(result.attributes.duration_ms),
            sizeBytes: asNumOrNull(result.attributes.tool_result_size_bytes),
          }
        : null,
    };
  });
}

export function ToolDecisionTimeline({ sessionId }: ToolDecisionTimelineProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["tool-decisions", sessionId],
    queryFn: () => fetchToolDecisions(sessionId),
  });

  if (isLoading) return <div className="font-mono text-xs text-muted-foreground p-4">loading tool timeline...</div>;
  if (error) return <div className="font-mono text-xs text-red-500 p-4">{(error as Error).message}</div>;
  if (!data || (data.decisions.length === 0 && data.results.length === 0)) return null;

  const rows = pairUp(data.decisions, data.results);

  // Group by prompt_id so a single prompt's tool sequence is visually contiguous
  const byPrompt = new Map<string, DecisionRow[]>();
  for (const r of rows) {
    const key = r.promptId ?? "(no prompt)";
    if (!byPrompt.has(key)) byPrompt.set(key, []);
    byPrompt.get(key)!.push(r);
  }

  return (
    <div className="space-y-4 font-mono text-xs">
      <h3 className="text-sm font-medium text-foreground">Tool decisions ({rows.length})</h3>
      {Array.from(byPrompt.entries()).map(([promptId, group]) => (
        <div key={promptId} className="rounded border border-border p-3 space-y-1">
          <div className="text-muted-foreground">prompt {promptId.slice(0, 8)}</div>
          {group.map((r, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className={r.decision === "accept" ? "text-emerald-500" : "text-amber-500"}>
                {r.decision}
              </span>
              <span className="text-foreground font-medium">{r.toolName}</span>
              <span className="text-muted-foreground">via {r.decisionSource}</span>
              {r.result && (
                <span className={r.result.success ? "text-muted-foreground" : "text-red-500"}>
                  {r.result.success ? "ok" : "fail"}
                  {r.result.durationMs != null && ` ${r.result.durationMs}ms`}
                  {r.result.sizeBytes != null && ` ${r.result.sizeBytes}B`}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
