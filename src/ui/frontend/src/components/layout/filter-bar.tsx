import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FilterBarProps {
  agent: string;
  dateFrom: string;
  onAgentChange: (value: string) => void;
  onDateChange: (value: string) => void;
}

export function FilterBar({ agent, dateFrom, onAgentChange, onDateChange }: FilterBarProps) {
  return (
    <div className="flex gap-2 p-2 px-3 border-b border-border">
      <Select value={agent} onValueChange={onAgentChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="All agents" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All agents</SelectItem>
          <SelectItem value="claude-code">Claude Code</SelectItem>
          <SelectItem value="codex">Codex</SelectItem>
          <SelectItem value="gemini">Gemini</SelectItem>
        </SelectContent>
      </Select>
      <Input
        type="date"
        value={dateFrom}
        onChange={(e) => onDateChange(e.target.value)}
        className="h-8 text-xs"
      />
    </div>
  );
}
