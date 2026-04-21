import { useState } from "react";
import { Card } from "@/components/ui/card";
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

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="px-3.5 py-2 bg-muted border-b border-border flex justify-between items-center">
        <span className="font-mono text-[11px] text-muted-foreground">
          Turn {record.turn_index} &middot; {formatTime(record.timestamp)}
        </span>
        <Button variant="ghost" size="sm" className="font-mono text-[11px] text-muted-foreground h-6 px-2" onClick={toggleRaw}>
          [ raw ]
        </Button>
      </div>
      <div className="px-3.5 py-2.5 text-sm text-muted-foreground border-b border-border">
        {record.response_summary}
      </div>
      {flags.length > 0 ? (
        flags.map((f) => <FlagCard key={f.id} flag={f} onStatusChange={onFlagStatusChange} onSaveNotes={onSaveNotes} />)
      ) : (
        <div className="px-3.5 py-2.5 text-xs text-muted-foreground">No flags extracted</div>
      )}
      {rawVisible && (
        <div className="mx-3.5 mb-3.5 mt-2 bg-muted border border-border rounded-sm p-3 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap overflow-x-auto max-h-72 overflow-y-auto">
          {rawLoading ? "loading..." : rawContent}
        </div>
      )}
    </Card>
  );
}
