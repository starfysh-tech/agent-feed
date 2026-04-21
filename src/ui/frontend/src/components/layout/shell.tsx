import { type ReactNode, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterBar } from "./filter-bar";
import { Separator } from "@/components/ui/separator";

interface ShellProps {
  currentView: string;
  onViewChange: (view: string) => void;
  agent: string;
  dateFrom: string;
  onAgentChange: (value: string) => void;
  onDateChange: (value: string) => void;
  sidebar: ReactNode;
  children: ReactNode;
}

export function Shell({
  currentView,
  onViewChange,
  agent,
  dateFrom,
  onAgentChange,
  onDateChange,
  sidebar,
  children,
}: ShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`w-80 min-w-80 bg-card border-r border-border flex flex-col overflow-hidden
          fixed top-0 left-0 bottom-0 z-20 transition-transform lg:relative lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="p-4 pb-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="font-mono text-xs font-medium text-primary tracking-wider uppercase">
              Agent Feed
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              coding agent decision log
            </div>
          </div>
          <button
            className="lg:hidden text-muted-foreground text-lg"
            onClick={() => setSidebarOpen(false)}
          >
            &times;
          </button>
        </div>
        <FilterBar
          agent={agent}
          dateFrom={dateFrom}
          onAgentChange={onAgentChange}
          onDateChange={onDateChange}
        />
        <Separator />
        <Tabs value={currentView} onValueChange={onViewChange} className="w-full">
          <TabsList className="w-full rounded-none border-b border-border bg-transparent h-auto p-0">
            <TabsTrigger
              value="sessions"
              className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary font-mono text-xs py-2"
            >
              Sessions
            </TabsTrigger>
            <TabsTrigger
              value="trends"
              className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary font-mono text-xs py-2"
            >
              Trends
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1 overflow-y-auto">{sidebar}</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-card border-b border-border p-3 px-4 flex items-center gap-3 lg:hidden">
          <button onClick={() => setSidebarOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>
          <span className="font-mono text-xs font-medium text-primary tracking-wider uppercase">
            Agent Feed
          </span>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
