import { cn } from "@/lib/utils";

interface FilterBarProps {
  models: string[];
  selectedModel: string;
  onModelChange: (value: string) => void;
}

function shortModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/-20\d{6}$/, "")
    .replace("gemini-", "")
    .replace("-preview", "");
}

export function FilterBar({ models, selectedModel, onModelChange }: FilterBarProps) {
  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 overflow-x-auto">
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
  );
}
