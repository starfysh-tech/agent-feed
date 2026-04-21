import { type ReactNode, useState } from "react";
import { FilterBar } from "./filter-bar";

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

      {/* Sidebar — repo-first navigation */}
      <div
        className={`w-72 min-w-72 bg-card border-r border-border flex flex-col overflow-hidden
          fixed top-0 left-0 bottom-0 z-20 transition-transform lg:relative lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="p-3 px-4 border-b border-border flex items-center justify-between">
          <span className="font-mono text-[10px] font-medium text-muted-foreground tracking-wider uppercase">
            Agent Feed
          </span>
          <button
            className="lg:hidden text-muted-foreground text-lg cursor-pointer"
            onClick={() => setSidebarOpen(false)}
          >
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{sidebar}</div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar: mobile hamburger + filters + view tabs */}
        <div className="shrink-0 border-b border-border">
          <div className="flex items-center gap-2">
            {/* Mobile hamburger */}
            <button
              className="lg:hidden p-3 cursor-pointer"
              onClick={() => setSidebarOpen(true)}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <line x1="3" y1="5" x2="17" y2="5" />
                <line x1="3" y1="10" x2="17" y2="10" />
                <line x1="3" y1="15" x2="17" y2="15" />
              </svg>
            </button>

            {/* Filters */}
            <div className="flex-1">
              <FilterBar
                agent={agent}
                dateFrom={dateFrom}
                onAgentChange={onAgentChange}
                onDateChange={onDateChange}
              />
            </div>

            {/* View tabs */}
            <div className="flex gap-1 pr-3">
              <button
                onClick={() => onViewChange("sessions")}
                className={`font-mono text-[10px] px-2.5 py-1.5 rounded-sm transition-colors cursor-pointer ${
                  currentView === "sessions"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sessions
              </button>
              <button
                onClick={() => onViewChange("trends")}
                className={`font-mono text-[10px] px-2.5 py-1.5 rounded-sm transition-colors cursor-pointer ${
                  currentView === "trends"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Trends
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
