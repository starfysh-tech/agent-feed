import { type ReactNode, useState } from "react";
import { FilterBar } from "./filter-bar";

interface ShellProps {
  currentView: string;
  onViewChange: (view: string) => void;
  models: string[];
  selectedModel: string;
  onModelChange: (value: string) => void;
  sidebar: ReactNode;
  children: ReactNode;
}

export function Shell({
  currentView,
  onViewChange,
  models,
  selectedModel,
  onModelChange,
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

      {/* Sidebar — narrow session rail */}
      <div
        className={`w-[200px] min-w-[200px] bg-card border-r border-border flex flex-col overflow-hidden
          fixed top-0 left-0 bottom-0 z-20 transition-transform lg:relative lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="p-2 px-3 border-b border-border flex items-center justify-between">
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
        {/* Top bar */}
        <div className="shrink-0 border-b border-border flex items-center">
          {/* Mobile hamburger */}
          <button
            className="lg:hidden p-2.5 cursor-pointer shrink-0"
            onClick={() => setSidebarOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>

          {/* Model filter */}
          <div className="flex-1">
            <FilterBar
              models={models}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
            />
          </div>

          {/* View tabs */}
          <div className="flex gap-1 pr-3 shrink-0">
            <button
              onClick={() => onViewChange("sessions")}
              className={`font-mono text-[10px] px-2 py-1 rounded-sm transition-colors cursor-pointer ${
                currentView === "sessions"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sessions
            </button>
            <button
              onClick={() => onViewChange("trends")}
              className={`font-mono text-[10px] px-2 py-1 rounded-sm transition-colors cursor-pointer ${
                currentView === "trends"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Trends
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
