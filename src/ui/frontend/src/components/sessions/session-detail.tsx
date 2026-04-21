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

  return (
    <div>
      <div className="mb-5 pb-4 border-b border-border">
        <h1 className="text-base font-semibold">{first.repo || sessionId}</h1>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          {first.agent} &middot; {first.model} &middot; {formatDate(first.timestamp)}
          {first.git_branch ? ` \u00b7 ${first.git_branch}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3 mb-5">
        <StatCard value={allFlags.length} label="total flags" />
        <StatCard value={unreviewed.length} label="unreviewed" className={unreviewed.length > 0 ? "text-yellow-400" : ""} />
        <StatCard value={accepted} label="accepted" className="text-green-400" />
        <StatCard value={needsChange} label="needs change" className="text-yellow-400" />
        <StatCard value={falsePos} label="false positive" className="text-red-400" />
        <StatCard value={records.length} label="turns" />
      </div>

      {unreviewed.length > 0 && (
        <div className="flex gap-2 items-center mb-4 p-3 px-4 bg-muted border border-border rounded-md">
          <span className="text-sm text-muted-foreground">{unreviewed.length} unreviewed flags</span>
          <Button variant="outline" size="sm" className="font-mono text-[11px] h-7 border-green-500 text-green-400 bg-green-500/10" onClick={() => handleBulk("accepted")}>accept all</Button>
          <Button variant="outline" size="sm" className="font-mono text-[11px] h-7 border-red-500 text-red-400" onClick={() => handleBulk("false_positive")}>mark all FP</Button>
        </div>
      )}

      {records.map((r) => (
        <TurnBlock key={r.id} record={r} sessionId={sessionId}
          onFlagStatusChange={(flagId, status) => updateStatus.mutate({ flagId, status })}
          onSaveNotes={(flagId, note, outcome) => saveNotes.mutate({ flagId, reviewerNote: note, outcome })} />
      ))}
    </div>
  );
}

function StatCard({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div className="bg-muted border border-border rounded-md p-3 px-4">
      <div className={`font-mono text-xl font-medium leading-tight ${className ?? ""}`}>{value}</div>
      <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}
