import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  models: string[];
  selectedModel: string;
  dateFrom: string;
  onModelChange: (value: string) => void;
  onDateChange: (value: string) => void;
}

function shortModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/-20\d{6}$/, "")
    .replace("gemini-", "")
    .replace("-preview", "");
}

export function FilterBar({ models, selectedModel, dateFrom, onModelChange, onDateChange }: FilterBarProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5">
      <div className="flex gap-0.5 overflow-x-auto">
        <button
          onClick={() => onModelChange("all")}
          className={cn(
            "font-mono text-[10px] px-2 py-1 rounded-sm transition-colors cursor-pointer whitespace-nowrap",
            selectedModel === "all"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-accent",
          )}
        >
          All
        </button>
        {models.map((m) => (
          <button
            key={m}
            onClick={() => onModelChange(m)}
            className={cn(
              "font-mono text-[10px] px-2 py-1 rounded-sm transition-colors cursor-pointer whitespace-nowrap",
              selectedModel === m
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {shortModel(m)}
          </button>
        ))}
      </div>
      <Input
        type="date"
        value={dateFrom}
        onChange={(e) => onDateChange(e.target.value)}
        className="h-6 text-[10px] font-mono w-28 ml-auto shrink-0"
      />
    </div>
  );
}
