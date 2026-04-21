import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FlagCard } from "@/components/flags/flag-card";
import { fetchRawRecord } from "@/api/client";
import { formatTime } from "@/lib/utils";
import type { Record, ReviewStatus } from "@/api/types";

interface TurnBlockProps {
  record: Record;
  sessionId: string;
  onFlagStatusChange: (flagId: string, status: ReviewStatus) => void;
  onSaveNotes: (flagId: string, note: string | null, outcome: string | null) => void;
}

export function TurnBlock({ record, sessionId, onFlagStatusChange, onSaveNotes }: TurnBlockProps) {
  const [rawVisible, setRawVisible] = useState(false);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [expandedFlagId, setExpandedFlagId] = useState<string | null>(null);

  async function toggleRaw() {
    if (rawVisible) { setRawVisible(false); return; }
    if (rawContent === null) {
      setRawLoading(true);
      try {
        const data = await fetchRawRecord(sessionId, record.id);
        let pretty = data.raw_response;
        try { pretty = JSON.stringify(JSON.parse(data.raw_response), null, 2); } catch { /* not JSON */ }
        setRawContent(pretty);
      } catch { setRawContent("Failed to load raw response"); }
      setRawLoading(false);
    }
    setRawVisible(true);
  }

  const flags = record.flags ?? [];

  // Sort: unreviewed first, then by confidence ascending (least confident = needs most attention)
  const sortedFlags = [...flags].sort((a, b) => {
    const aReviewed = a.review_status !== "unreviewed" ? 1 : 0;
    const bReviewed = b.review_status !== "unreviewed" ? 1 : 0;
    if (aReviewed !== bReviewed) return aReviewed - bReviewed;
    return a.confidence - b.confidence;
  });

  return (
    <div className="mb-4">
      {/* Turn header */}
      <div className="flex items-center justify-between px-1 mb-1.5">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
          Turn {record.turn_index} &middot; {formatTime(record.timestamp)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-[10px] text-muted-foreground h-5 px-1.5"
          onClick={toggleRaw}
        >
          raw
        </Button>
      </div>

      {/* Summary */}
      <p className="text-sm text-muted-foreground px-1 mb-2 leading-relaxed">
        {record.response_summary}
      </p>

      {/* Flags */}
      {sortedFlags.length > 0 ? (
        <div className="border border-border rounded-md overflow-hidden divide-y divide-border">
          {sortedFlags.map((f) => (
            <FlagCard
              key={f.id}
              flag={f}
              expanded={expandedFlagId === f.id}
              onToggle={() => setExpandedFlagId(expandedFlagId === f.id ? null : f.id)}
              onStatusChange={onFlagStatusChange}
              onSaveNotes={onSaveNotes}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground px-1">No flags extracted</p>
      )}

      {/* Raw response */}
      {rawVisible && (
        <div className="mt-2 bg-muted border border-border rounded-md p-3 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap overflow-x-auto max-h-72 overflow-y-auto">
          {rawLoading ? "loading..." : rawContent}
        </div>
      )}
    </div>
  );
}
