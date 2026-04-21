import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  agent: string;
  dateFrom: string;
  onAgentChange: (value: string) => void;
  onDateChange: (value: string) => void;
}

const AGENTS = [
  { value: "all", label: "All" },
  { value: "claude-code", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
];

export function FilterBar({ agent, dateFrom, onAgentChange, onDateChange }: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 p-2 px-3 border-b border-border">
      <div className="flex gap-1">
        {AGENTS.map((a) => (
          <button
            key={a.value}
            onClick={() => onAgentChange(a.value)}
            className={cn(
              "font-mono text-[10px] px-2 py-1 rounded-sm transition-colors cursor-pointer",
              agent === a.value
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      <Input
        type="date"
        value={dateFrom}
        onChange={(e) => onDateChange(e.target.value)}
        className="h-7 text-[10px] font-mono w-32 ml-auto"
      />
    </div>
  );
}
