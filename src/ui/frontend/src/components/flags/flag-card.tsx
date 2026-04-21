import { useState, useRef, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Flag, ReviewStatus } from "@/api/types";

interface FlagCardProps {
  flag: Flag;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (flagId: string, status: ReviewStatus) => void;
  onSaveNotes: (flagId: string, note: string | null, outcome: string | null) => void;
}

const STATUS_OPTIONS: { value: ReviewStatus; label: string; key: string }[] = [
  { value: "accepted", label: "accept", key: "a" },
  { value: "needs_change", label: "needs change", key: "n" },
  { value: "false_positive", label: "false positive", key: "f" },
];

const STATUS_ACTIVE: Record<string, string> = {
  accepted: "bg-emerald-500/15 text-emerald-400",
  needs_change: "bg-amber-400/15 text-amber-400",
  false_positive: "bg-rose-400/15 text-rose-400",
};

const TYPE_COLOR: Record<string, string> = {
  decision: "text-[oklch(0.72_0.14_250)]",
  assumption: "text-[oklch(0.72_0.14_55)]",
  architecture: "text-[oklch(0.72_0.14_155)]",
  pattern: "text-[oklch(0.68_0.14_300)]",
  dependency: "text-[oklch(0.72_0.12_230)]",
  tradeoff: "text-[oklch(0.78_0.14_85)]",
  constraint: "text-[oklch(0.65_0.18_25)]",
  workaround: "text-[oklch(0.72_0.12_75)]",
  risk: "text-[oklch(0.65_0.18_20)]",
};

function getTypeColor(type: string) {
  return TYPE_COLOR[type] ?? "text-foreground";
}

export function FlagCard({ flag, expanded, onToggle, onStatusChange, onSaveNotes }: FlagCardProps) {
  const isReviewed = flag.review_status !== "unreviewed";
  const [note, setNote] = useState(flag.reviewer_note ?? "");
  const [outcome, setOutcome] = useState(flag.outcome ?? "");
  const noteRef = useRef<HTMLInputElement>(null);
  const outcomeRef = useRef<HTMLInputElement>(null);
  const savedNote = useRef(flag.reviewer_note ?? "");
  const savedOutcome = useRef(flag.outcome ?? "");

  // Sync from props when flag changes (e.g. after mutation revalidation)
  useEffect(() => {
    setNote(flag.reviewer_note ?? "");
    setOutcome(flag.outcome ?? "");
    savedNote.current = flag.reviewer_note ?? "";
    savedOutcome.current = flag.outcome ?? "";
  }, [flag.reviewer_note, flag.outcome]);

  const handleBlurSave = useCallback(() => {
    const n = note || null;
    const o = outcome || null;
    if (n !== (savedNote.current || null) || o !== (savedOutcome.current || null)) {
      savedNote.current = note;
      savedOutcome.current = outcome;
      onSaveNotes(flag.id, n, o);
    }
  }, [flag.id, note, outcome, onSaveNotes]);

  const confidence = Math.round(flag.confidence * 100);

  // ── Collapsed: reviewed items ──
  if (isReviewed && !expanded) {
    return (
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 px-4 py-1.5 opacity-45 hover:opacity-70 transition-opacity cursor-pointer"
      >
        <span className={cn("font-mono text-[10px] uppercase tracking-wide w-24 shrink-0", getTypeColor(flag.type))}>
          {flag.type}
        </span>
        <span className="text-xs text-muted-foreground truncate flex-1">{flag.content}</span>
        <Badge
          variant="outline"
          className={cn("text-[9px] font-mono shrink-0 border-0", STATUS_ACTIVE[flag.review_status])}
        >
          {flag.review_status.replace("_", " ")}
        </Badge>
      </button>
    );
  }

  // ── Collapsed: unreviewed items ──
  if (!expanded) {
    return (
      <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors">
        <button onClick={onToggle} className="flex items-start gap-3 flex-1 text-left cursor-pointer min-w-0">
          <span className={cn("font-mono text-[10px] uppercase tracking-wide w-24 shrink-0 pt-0.5", getTypeColor(flag.type))}>
            {flag.type}
          </span>
          <span className="text-sm text-foreground flex-1 min-w-0 truncate">{flag.content}</span>
          <span className="font-mono text-[10px] text-muted-foreground shrink-0 pt-0.5">
            {confidence}%
          </span>
        </button>
        <div className="flex gap-1 shrink-0">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              variant="ghost"
              size="sm"
              className="font-mono text-[10px] h-6 px-2 text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onStatusChange(flag.id, value); }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  // ── Expanded ──
  return (
    <div className="bg-accent/20 px-4 py-3 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className={cn("font-mono text-[10px] uppercase tracking-wide w-24 shrink-0 pt-0.5", getTypeColor(flag.type))}>
            {flag.type}
          </span>
          <div className="min-w-0">
            <button onClick={onToggle} className="text-sm text-foreground font-medium cursor-pointer hover:text-muted-foreground transition-colors">
              {flag.content}
            </button>
          </div>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground shrink-0 pt-0.5">
          {confidence}%
        </span>
      </div>

      {/* Context */}
      {flag.context && (
        <p className="text-xs text-muted-foreground leading-relaxed ml-27 pl-0.5">
          {flag.context}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 ml-27">
        {STATUS_OPTIONS.map(({ value, label }) => (
          <Button
            key={value}
            variant="outline"
            size="sm"
            className={cn(
              "font-mono text-[10px] h-6 px-2.5",
              flag.review_status === value && STATUS_ACTIVE[value],
            )}
            onClick={() => onStatusChange(flag.id, value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Notes — only in expanded */}
      <div className="flex gap-2 ml-27">
        <Input
          ref={noteRef}
          placeholder="Note..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={handleBlurSave}
          className="h-7 text-xs flex-1"
        />
        <Input
          ref={outcomeRef}
          placeholder="Outcome..."
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          onBlur={handleBlurSave}
          className="h-7 text-xs flex-1"
        />
      </div>
    </div>
  );
}
