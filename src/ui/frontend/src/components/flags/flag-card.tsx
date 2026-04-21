import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFlagColors, cn } from "@/lib/utils";
import type { Flag, ReviewStatus } from "@/api/types";

interface FlagCardProps {
  flag: Flag;
  onStatusChange: (flagId: string, status: ReviewStatus) => void;
  onSaveNotes: (flagId: string, note: string | null, outcome: string | null) => void;
}

const STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: "accepted", label: "accept" },
  { value: "needs_change", label: "needs change" },
  { value: "false_positive", label: "false positive" },
];

const STATUS_STYLES: Record<string, string> = {
  accepted: "border-green-500 text-green-400 bg-green-500/10",
  needs_change: "border-yellow-500 text-yellow-400 bg-yellow-500/10",
  false_positive: "border-red-500 text-red-400 bg-red-500/10",
};

export function FlagCard({ flag, onStatusChange, onSaveNotes }: FlagCardProps) {
  const [note, setNote] = useState(flag.reviewer_note ?? "");
  const [outcome, setOutcome] = useState(flag.outcome ?? "");
  const colors = getFlagColors(flag.type);

  return (
    <Card className={cn("border-l-4 rounded-none border-b border-border shadow-none", colors.border)}>
      <CardContent className="p-3 px-4 space-y-2">
        <div className="flex justify-between items-center">
          <Badge
            variant="outline"
            className={cn(
              "font-mono text-[10px] uppercase tracking-wider rounded-sm",
              colors.bg,
              colors.text,
            )}
          >
            {flag.type}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">
            {Math.round(flag.confidence * 100)}% confidence
          </span>
        </div>

        <p className="text-sm font-medium leading-relaxed">{flag.content}</p>

        {flag.context && (
          <div className="text-xs text-muted-foreground italic bg-muted p-3 border-l-2 border-border rounded-r-sm leading-relaxed">
            {flag.context}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              variant="outline"
              size="sm"
              className={cn(
                "font-mono text-[11px] h-7",
                flag.review_status === value && STATUS_STYLES[value],
              )}
              onClick={() => onStatusChange(flag.id, value)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <Input placeholder="Reviewer note..." value={note} onChange={(e) => setNote(e.target.value)} className="h-8 text-xs" />
          <Input placeholder="Outcome..." value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-8 text-xs" />
          <div className="flex justify-end">
            <Button size="sm" className="font-mono text-[11px] h-7" onClick={() => onSaveNotes(flag.id, note || null, outcome || null)}>
              save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
