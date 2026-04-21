import { useSession } from "@/hooks/use-session";
import { useUpdateFlagStatus, useSaveNotes, useBulkUpdate } from "@/hooks/use-flag-mutations";
import { TurnBlock } from "./turn-block";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { ReviewStatus } from "@/api/types";

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const { data: records, isLoading, error } = useSession(sessionId);
  const updateStatus = useUpdateFlagStatus(sessionId);
  const saveNotes = useSaveNotes(sessionId);
  const bulkUpdate = useBulkUpdate(sessionId);

  if (isLoading) return <div className="p-10 text-center font-mono text-xs text-muted-foreground">loading session...</div>;
  if (error || !records?.length) return <div className="p-10 text-center text-sm text-muted-foreground">Session not found.</div>;

  const allFlags = records.flatMap((r) => r.flags ?? []);
  const unreviewed = allFlags.filter((f) => f.review_status === "unreviewed");
  const accepted = allFlags.filter((f) => f.review_status === "accepted").length;
  const needsChange = allFlags.filter((f) => f.review_status === "needs_change").length;
  const falsePos = allFlags.filter((f) => f.review_status === "false_positive").length;
  const first = records[0];

  function handleBulk(status: ReviewStatus) {
    const ids = unreviewed.map((f) => f.id);
    if (!ids.length) return;
    if (!confirm(`Update ${ids.length} flags to "${status.replace("_", " ")}"?`)) return;
    bulkUpdate.mutate({ flagIds: ids, status });
  }

  // Build a compact summary string
  const parts: string[] = [];
  parts.push(`${allFlags.length} flag${allFlags.length !== 1 ? "s" : ""}`);
  if (unreviewed.length > 0) parts.push(`${unreviewed.length} unreviewed`);
  if (accepted > 0) parts.push(`${accepted} accepted`);
  if (needsChange > 0) parts.push(`${needsChange} needs change`);
  if (falsePos > 0) parts.push(`${falsePos} FP`);
  const turnsWithFlags = records.filter((r) => (r.flags?.length ?? 0) > 0).length;
  parts.push(`${turnsWithFlags} turn${turnsWithFlags !== 1 ? "s" : ""} with flags`);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-base font-semibold tracking-tight">{first.repo || sessionId}</h1>
        <p className="font-mono text-[11px] text-muted-foreground mt-1 leading-relaxed">
          {first.agent} · {first.model} · {formatDate(first.timestamp)}
          {first.git_branch ? ` · ${first.git_branch}` : ""}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
          {parts.join(" · ")}
        </p>
      </div>

      {/* Bulk actions — only when there's something to triage */}
      {unreviewed.length > 0 && (
        <div className="flex items-center gap-3 mb-5 font-mono text-[11px]">
          <span className="text-muted-foreground">{unreviewed.length} unreviewed</span>
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-[10px] h-6 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
            onClick={() => handleBulk("accepted")}
          >
            accept all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-[10px] h-6 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
            onClick={() => handleBulk("false_positive")}
          >
            mark all FP
          </Button>
        </div>
      )}

      {/* Turns — newest first */}
      {[...records].reverse().map((r) => (
        <TurnBlock
          key={r.id}
          record={r}
          sessionId={sessionId}
          onFlagStatusChange={(flagId, status) => updateStatus.mutate({ flagId, status })}
          onSaveNotes={(flagId, note, outcome) => saveNotes.mutate({ flagId, reviewerNote: note, outcome })}
        />
      ))}
    </div>
  );
}
