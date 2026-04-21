import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  const [showFullText, setShowFullText] = useState(false);

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

  const responseText = record.response_text;
  const previewText = responseText && responseText.length > 500
    ? responseText.slice(0, 500)
    : responseText;
  const isLong = (responseText?.length ?? 0) > 500;

  return (
    <div className={`mb-5 ${allReviewed ? "opacity-50 hover:opacity-75 transition-opacity" : ""}`}>
      {/* Summary + timestamp */}
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">summary</span>
          <p className="text-sm text-foreground leading-relaxed mt-0.5">
            {record.response_summary}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-3">
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

      {/* Agent response — the actual message being analyzed */}
      {responseText && (
        <div className="mb-2">
          <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">agent response</span>
          <div className="mt-1 bg-card/50 border border-border/50 rounded-md p-3 max-h-64 overflow-y-auto">
          <div className="prose prose-invert prose-xs max-w-none
            [&_table]:text-[11px] [&_table]:font-mono [&_table]:border-collapse
            [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:bg-muted
            [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1
            [&_p]:text-xs [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_p]:my-1
            [&_code]:text-[11px] [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded
            [&_pre]:text-[11px] [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto
            [&_ul]:text-xs [&_ul]:text-muted-foreground [&_ul]:my-1 [&_ul]:pl-4
            [&_ol]:text-xs [&_ol]:text-muted-foreground [&_ol]:my-1 [&_ol]:pl-4
            [&_li]:my-0.5
            [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mt-2 [&_h1]:mb-1
            [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-2 [&_h2]:mb-1
            [&_h3]:text-xs [&_h3]:font-medium [&_h3]:text-foreground [&_h3]:mt-1 [&_h3]:mb-0.5
            [&_strong]:text-foreground
            [&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline
          ">
            <Markdown remarkPlugins={[remarkGfm]}>
              {showFullText ? responseText : (previewText ?? "")}
            </Markdown>
          </div>
          {isLong && (
            <button
              onClick={() => setShowFullText(!showFullText)}
              className="mt-1 text-primary font-mono text-[10px] hover:underline cursor-pointer"
            >
              {showFullText ? "show less" : "show more"}
            </button>
          )}
          </div>
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
