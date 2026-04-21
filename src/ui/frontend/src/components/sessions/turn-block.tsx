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

  // Skip turns with no flags — they're noise in the review view
  if (!flags.length) return null;

  // Sort: unreviewed first, then by confidence ascending (least confident = needs most attention)
  const sortedFlags = [...flags].sort((a, b) => {
    const aReviewed = a.review_status !== "unreviewed" ? 1 : 0;
    const bReviewed = b.review_status !== "unreviewed" ? 1 : 0;
    if (aReviewed !== bReviewed) return aReviewed - bReviewed;
    return a.confidence - b.confidence;
  });

  const allReviewed = flags.every((f) => f.review_status !== "unreviewed");

  const [showFullText, setShowFullText] = useState(false);
  const responseText = record.response_text;
  // Truncate long response text to first 500 chars for preview
  const previewText = responseText && responseText.length > 500
    ? responseText.slice(0, 500) + "..."
    : responseText;

  return (
    <div className={`mb-5 ${allReviewed ? "opacity-50 hover:opacity-75 transition-opacity" : ""}`}>
      {/* Summary line + controls */}
      <div className="flex items-start justify-between gap-4 mb-1.5">
        <p className="text-sm text-foreground leading-relaxed">
          {record.response_summary}
        </p>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatTime(record.timestamp)}
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
      </div>

      {/* Actual agent response text — the source material for the flags */}
      {responseText && (
        <div className="mb-2 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap bg-card/50 rounded-md p-3 max-h-48 overflow-y-auto">
          {showFullText ? responseText : previewText}
          {responseText.length > 500 && (
            <button
              onClick={() => setShowFullText(!showFullText)}
              className="ml-1 text-primary font-mono text-[10px] hover:underline cursor-pointer"
            >
              {showFullText ? "less" : "more"}
            </button>
          )}
        </div>
      )}

      {/* Flags — directly under the context that produced them */}
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

      {/* Raw response */}
      {rawVisible && (
        <div className="mt-2 bg-muted border border-border rounded-md p-3 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap overflow-x-auto max-h-72 overflow-y-auto">
          {rawLoading ? "loading..." : rawContent}
        </div>
      )}
    </div>
  );
}
