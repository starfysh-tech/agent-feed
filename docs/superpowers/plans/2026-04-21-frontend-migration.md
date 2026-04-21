# Frontend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline `buildHTML()` UI in `src/ui/server.js` with a Vite + React + shadcn/ui SPA that consumes the existing API.

**Architecture:** The frontend becomes a separate Vite project at `src/ui/frontend/` with its own `package.json`. The Node.js server keeps all API routes unchanged but drops `buildHTML()` and instead serves the Vite build output as static files. In development, Vite runs its own dev server with HMR and proxies API calls to the daemon.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind CSS v4, shadcn/ui (Radix primitives), TanStack Query v5, TanStack Table v8, Sonner (toasts)

---

## File Map

### New files (all under `src/ui/frontend/`)

| File | Responsibility |
|------|---------------|
| `package.json` | Frontend deps (react, @tanstack/react-query, @tanstack/react-table, tailwindcss, sonner) |
| `vite.config.ts` | Vite config with API proxy to port 3000 |
| `tsconfig.json` | TypeScript config for React JSX |
| `index.html` | Vite entry HTML (minimal — just `<div id="root">`) |
| `src/main.tsx` | React root mount + QueryClientProvider |
| `src/App.tsx` | Top-level layout: sidebar + main panel, URL search params for filters/view |
| `src/lib/utils.ts` | `cn()` helper (clsx + tailwind-merge), `formatDate()` |
| `src/api/client.ts` | Typed fetch wrappers for all 6 API endpoints |
| `src/api/types.ts` | TypeScript types for Session, Record, Flag, Trends — matching DB schema exactly |
| `src/hooks/use-sessions.ts` | TanStack Query hook: `useSessions(agent, dateFrom)` |
| `src/hooks/use-session.ts` | TanStack Query hook: `useSession(id)` → records with flags |
| `src/hooks/use-trends.ts` | TanStack Query hook: `useTrends(filters)` |
| `src/hooks/use-flag-mutations.ts` | Mutations: `useUpdateFlag()`, `useSaveNotes()`, `useBulkUpdate()` |
| `src/components/layout/shell.tsx` | App shell: sidebar + main content area + mobile responsive |
| `src/components/layout/filter-bar.tsx` | Agent select + date picker, reads/writes URL search params |
| `src/components/sessions/session-list.tsx` | Sidebar session list with search, sort, unreviewed badges |
| `src/components/sessions/session-detail.tsx` | Main panel: stat cards + bulk actions + turn timeline |
| `src/components/sessions/turn-block.tsx` | Single turn: header, summary, flag cards, raw toggle |
| `src/components/flags/flag-card.tsx` | The core review card: badge, content, context, actions, notes |
| `src/components/trends/trend-view.tsx` | Trends panel: by-type bars, by-session list |
| `src/components/ui/*.tsx` | shadcn components (installed via CLI): badge, button, card, input, select, separator, tabs, sonner |
| `src/styles/globals.css` | Tailwind directives + flag type color CSS custom properties |

### Modified files

| File | Change |
|------|--------|
| `src/ui/server.js` | Remove `buildHTML()` and all client-side JS (~700 lines). Add static file serving for `frontend/dist/`. Keep all API routes and helpers (`json()`, `readBody()`, `VALID_REVIEW_STATUSES`). |
| `test/ui.test.js` | Update the `GET /` test: instead of checking for `<!DOCTYPE html>` from `buildHTML()`, check that the response serves the built `index.html` from `dist/` (or returns 404 if `dist/` doesn't exist yet). |
| `package.json` (root) | Add `"dev:ui"` and `"build:ui"` scripts. |
| `.gitignore` | Add `src/ui/frontend/dist/`, `src/ui/frontend/node_modules/` |

---

## Task 1: Scaffold Vite + React + TypeScript project

**Files:**
- Create: `src/ui/frontend/package.json`
- Create: `src/ui/frontend/vite.config.ts`
- Create: `src/ui/frontend/tsconfig.json`
- Create: `src/ui/frontend/tsconfig.node.json`
- Create: `src/ui/frontend/index.html`
- Create: `src/ui/frontend/src/main.tsx`
- Create: `src/ui/frontend/src/vite-env.d.ts`
- Modify: `package.json` (root)
- Modify: `.gitignore`

- [ ] **Step 1: Create `src/ui/frontend/package.json`**

```json
{
  "name": "agent-feed-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@radix-ui/react-select": "^2.1.6",
    "@radix-ui/react-separator": "^1.1.2",
    "@radix-ui/react-slot": "^1.1.2",
    "@radix-ui/react-tabs": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.1.8",
    "@tanstack/react-query": "^5.75.0",
    "@tanstack/react-table": "^8.21.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.475.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "sonner": "^2.0.3",
    "tailwind-merge": "^3.0.2"
  },
  "devDependencies": {
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "@tailwindcss/vite": "^4.1.4",
    "@vitejs/plugin-react": "^4.4.1",
    "tailwindcss": "^4.1.4",
    "typescript": "^5.8.3",
    "vite": "^6.3.3"
  }
}
```

- [ ] **Step 2: Create `src/ui/frontend/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyDirFirst: true,
  },
});
```

- [ ] **Step 3: Create `src/ui/frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `src/ui/frontend/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `src/ui/frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Feed</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/ui/frontend/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 7: Create `src/ui/frontend/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "font-sans text-sm",
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 8: Add scripts to root `package.json`**

Add these to the existing `"scripts"` object in the root `package.json`:

```json
"dev:ui": "cd src/ui/frontend && npm run dev",
"build:ui": "cd src/ui/frontend && npm run build"
```

- [ ] **Step 9: Update `.gitignore`**

Append to `.gitignore`:

```
src/ui/frontend/node_modules/
src/ui/frontend/dist/
```

- [ ] **Step 10: Install dependencies**

Run: `cd src/ui/frontend && npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 11: Verify dev server starts**

Run: `cd src/ui/frontend && npx vite --host localhost &` then `sleep 3 && curl -s http://localhost:5173/ | head -5`
Expected: HTML response containing `<div id="root">`. Kill the vite process after.

- [ ] **Step 12: Commit**

```bash
git add src/ui/frontend/package.json src/ui/frontend/package-lock.json \
  src/ui/frontend/vite.config.ts src/ui/frontend/tsconfig.json \
  src/ui/frontend/tsconfig.node.json src/ui/frontend/index.html \
  src/ui/frontend/src/main.tsx src/ui/frontend/src/vite-env.d.ts \
  package.json .gitignore
git commit -m "feat(ui): scaffold Vite + React + Tailwind frontend project"
```

---

## Task 2: Tailwind globals + shadcn components + utility helpers

**Files:**
- Create: `src/ui/frontend/src/styles/globals.css`
- Create: `src/ui/frontend/src/lib/utils.ts`
- Create: `src/ui/frontend/src/components/ui/button.tsx`
- Create: `src/ui/frontend/src/components/ui/badge.tsx`
- Create: `src/ui/frontend/src/components/ui/card.tsx`
- Create: `src/ui/frontend/src/components/ui/input.tsx`
- Create: `src/ui/frontend/src/components/ui/select.tsx`
- Create: `src/ui/frontend/src/components/ui/separator.tsx`
- Create: `src/ui/frontend/src/components/ui/tabs.tsx`
- Create: `src/ui/frontend/src/components/ui/tooltip.tsx`
- Create: `src/ui/frontend/components.json` (shadcn config)

- [ ] **Step 1: Create `src/ui/frontend/src/styles/globals.css`**

```css
@import "tailwindcss";

@theme {
  /* Flag type colors — single source of truth */
  --color-flag-decision: #4a9eff;
  --color-flag-decision-bg: #1a2a3a;
  --color-flag-assumption: #f08030;
  --color-flag-assumption-bg: #2a1a0f;
  --color-flag-architecture: #3dd68c;
  --color-flag-architecture-bg: #1a2a1a;
  --color-flag-pattern: #a070e8;
  --color-flag-pattern-bg: #2a1a2a;
  --color-flag-dependency: #40b0f0;
  --color-flag-dependency-bg: #0f1a2a;
  --color-flag-tradeoff: #f0c040;
  --color-flag-tradeoff-bg: #2a2a0f;
  --color-flag-constraint: #f05060;
  --color-flag-constraint-bg: #2a1010;
  --color-flag-workaround: #d0a030;
  --color-flag-workaround-bg: #1a1a0f;
  --color-flag-risk: #f06070;
  --color-flag-risk-bg: #2a1010;
}

@layer base {
  :root {
    --background: 222.2 47.4% 4.2%;
    --foreground: 210 20% 90%;
    --card: 222.2 47.4% 6.2%;
    --card-foreground: 210 20% 90%;
    --popover: 222.2 47.4% 6.2%;
    --popover-foreground: 210 20% 90%;
    --primary: 213 94% 64%;
    --primary-foreground: 0 0% 100%;
    --secondary: 217.2 32.6% 12%;
    --secondary-foreground: 210 20% 90%;
    --muted: 217.2 32.6% 12%;
    --muted-foreground: 215 16% 52%;
    --accent: 217.2 32.6% 15%;
    --accent-foreground: 210 20% 90%;
    --destructive: 0 70% 50%;
    --destructive-foreground: 210 20% 90%;
    --border: 217.2 20% 16%;
    --input: 217.2 20% 16%;
    --ring: 213 94% 64%;
    --radius: 0.375rem;
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground antialiased;
    font-family: "IBM Plex Sans", sans-serif;
  }
}
```

- [ ] **Step 2: Create `src/ui/frontend/src/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString();
}

export const FLAG_TYPE_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  decision:     { border: "border-l-[#4a9eff]", bg: "bg-[#1a2a3a]", text: "text-[#4a9eff]" },
  assumption:   { border: "border-l-[#f08030]", bg: "bg-[#2a1a0f]", text: "text-[#f08030]" },
  architecture: { border: "border-l-[#3dd68c]", bg: "bg-[#1a2a1a]", text: "text-[#3dd68c]" },
  pattern:      { border: "border-l-[#a070e8]", bg: "bg-[#2a1a2a]", text: "text-[#a070e8]" },
  dependency:   { border: "border-l-[#40b0f0]", bg: "bg-[#0f1a2a]", text: "text-[#40b0f0]" },
  tradeoff:     { border: "border-l-[#f0c040]", bg: "bg-[#2a2a0f]", text: "text-[#f0c040]" },
  constraint:   { border: "border-l-[#f05060]", bg: "bg-[#2a1010]", text: "text-[#f05060]" },
  workaround:   { border: "border-l-[#d0a030]", bg: "bg-[#1a1a0f]", text: "text-[#d0a030]" },
  risk:         { border: "border-l-[#f06070]", bg: "bg-[#2a1010]", text: "text-[#f06070]" },
};

export function getFlagColors(type: string) {
  return FLAG_TYPE_COLORS[type] ?? { border: "border-l-primary", bg: "bg-primary/10", text: "text-primary" };
}
```

- [ ] **Step 3: Create shadcn config file `src/ui/frontend/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 4: Install shadcn components**

Run from `src/ui/frontend/`:

```bash
npx shadcn@latest add button badge card input select separator tabs tooltip -y
```

This copies component files into `src/components/ui/`. If the CLI prompts for config, accept defaults.

Expected: Files created in `src/ui/frontend/src/components/ui/` for each component.

- [ ] **Step 5: Verify the project compiles**

Run: `cd src/ui/frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/randallnoval/Code/agent-feed
git add src/ui/frontend/src/styles/ src/ui/frontend/src/lib/ \
  src/ui/frontend/src/components/ui/ src/ui/frontend/components.json
git commit -m "feat(ui): add Tailwind globals, shadcn components, and utility helpers"
```

---

## Task 3: API types and fetch client

**Files:**
- Create: `src/ui/frontend/src/api/types.ts`
- Create: `src/ui/frontend/src/api/client.ts`

- [ ] **Step 1: Create `src/ui/frontend/src/api/types.ts`**

These types match the exact shapes returned by the existing API (confirmed by reading `database.js` and `server.js`):

```ts
export interface Session {
  session_id: string;
  agent: string;
  model: string;
  repo: string | null;
  git_branch: string | null;
  latest_timestamp: string;
  turn_count: number;
  // Enriched by server from getSessionFlagCounts()
  total_flags: number;
  unreviewed_flags: number;
}

export interface Flag {
  id: string;
  record_id: string;
  type: FlagType;
  content: string;
  context: string | null;
  confidence: number;
  review_status: ReviewStatus;
  reviewer_note: string | null;
  outcome: string | null;
}

export interface Record {
  id: string;
  timestamp: string;
  agent: string;
  agent_version: string | null;
  session_id: string;
  turn_index: number;
  repo: string | null;
  working_directory: string;
  git_branch: string | null;
  git_commit: string | null;
  request_summary: string | null;
  response_summary: string;
  raw_request: string | null;
  raw_response: string;
  token_count: number | null;
  model: string;
  flags: Flag[];
}

export interface RawResponse {
  raw_response: string;
  raw_request: string | null;
}

export interface TrendsByType {
  type: string;
  count: number;
  false_positive_rate: number;
}

export interface TrendsBySession {
  session_id: string;
  agent: string;
  repo: string | null;
  git_branch: string | null;
  latest_timestamp: string;
  flag_count: number;
}

export interface Trends {
  total_flags: number;
  by_type: TrendsByType[];
  by_session: TrendsBySession[];
}

export type FlagType =
  | "decision"
  | "assumption"
  | "architecture"
  | "pattern"
  | "dependency"
  | "tradeoff"
  | "constraint"
  | "workaround"
  | "risk";

export type ReviewStatus =
  | "unreviewed"
  | "accepted"
  | "needs_change"
  | "false_positive";
```

- [ ] **Step 2: Create `src/ui/frontend/src/api/client.ts`**

```ts
import type { Session, Record, RawResponse, Trends, ReviewStatus } from "./types";

const BASE = "";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function fetchSessions(params: {
  agent?: string;
  date?: string;
}): Promise<Session[]> {
  const sp = new URLSearchParams();
  if (params.agent) sp.set("agent", params.agent);
  if (params.date) sp.set("date", params.date);
  const qs = sp.toString();
  return fetchJSON(`/api/sessions${qs ? `?${qs}` : ""}`);
}

export function fetchSession(sessionId: string): Promise<Record[]> {
  return fetchJSON(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function fetchRawRecord(
  sessionId: string,
  recordId: string,
): Promise<RawResponse> {
  return fetchJSON(
    `/api/sessions/${encodeURIComponent(sessionId)}/records/${encodeURIComponent(recordId)}/raw`,
  );
}

export function updateFlag(
  flagId: string,
  data: {
    review_status?: ReviewStatus;
    reviewer_note?: string | null;
    outcome?: string | null;
  },
): Promise<{ ok: boolean }> {
  return fetchJSON(`/api/flags/${encodeURIComponent(flagId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function bulkUpdateFlags(
  flagIds: string[],
  reviewStatus: ReviewStatus,
): Promise<{ ok: boolean; updated: number }> {
  return fetchJSON("/api/flags/bulk", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flag_ids: flagIds, review_status: reviewStatus }),
  });
}

export function fetchTrends(params: {
  agent?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<Trends> {
  const sp = new URLSearchParams();
  if (params.agent) sp.set("agent", params.agent);
  if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
  if (params.dateTo) sp.set("dateTo", params.dateTo);
  const qs = sp.toString();
  return fetchJSON(`/api/trends${qs ? `?${qs}` : ""}`);
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd src/ui/frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/randallnoval/Code/agent-feed
git add src/ui/frontend/src/api/
git commit -m "feat(ui): add typed API client and response types"
```

---

## Task 4: TanStack Query hooks and mutations

**Files:**
- Create: `src/ui/frontend/src/hooks/use-sessions.ts`
- Create: `src/ui/frontend/src/hooks/use-session.ts`
- Create: `src/ui/frontend/src/hooks/use-trends.ts`
- Create: `src/ui/frontend/src/hooks/use-flag-mutations.ts`

- [ ] **Step 1: Create `src/ui/frontend/src/hooks/use-sessions.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchSessions } from "@/api/client";

export function useSessions(agent?: string, dateFrom?: string) {
  return useQuery({
    queryKey: ["sessions", agent ?? "", dateFrom ?? ""],
    queryFn: () => fetchSessions({ agent, date: dateFrom }),
  });
}
```

- [ ] **Step 2: Create `src/ui/frontend/src/hooks/use-session.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchSession } from "@/api/client";

export function useSession(sessionId: string | null) {
  return useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => fetchSession(sessionId!),
    enabled: !!sessionId,
  });
}
```

- [ ] **Step 3: Create `src/ui/frontend/src/hooks/use-trends.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchTrends } from "@/api/client";

export function useTrends(params: {
  agent?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  return useQuery({
    queryKey: ["trends", params.agent ?? "", params.dateFrom ?? "", params.dateTo ?? ""],
    queryFn: () => fetchTrends(params),
  });
}
```

- [ ] **Step 4: Create `src/ui/frontend/src/hooks/use-flag-mutations.ts`**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateFlag, bulkUpdateFlags } from "@/api/client";
import type { ReviewStatus } from "@/api/types";
import { toast } from "sonner";

export function useUpdateFlagStatus(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flagId, status }: { flagId: string; status: ReviewStatus }) =>
      updateFlag(flagId, { review_status: status }),
    onSuccess: () => {
      toast.success("Flag updated");
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to update flag: ${err.message}`);
    },
  });
}

export function useSaveNotes(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      flagId,
      reviewerNote,
      outcome,
    }: {
      flagId: string;
      reviewerNote: string | null;
      outcome: string | null;
    }) => updateFlag(flagId, { reviewer_note: reviewerNote, outcome }),
    onSuccess: () => {
      toast.success("Notes saved");
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to save notes: ${err.message}`);
    },
  });
}

export function useBulkUpdate(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flagIds, status }: { flagIds: string[]; status: ReviewStatus }) =>
      bulkUpdateFlags(flagIds, status),
    onSuccess: (_data, variables) => {
      toast.success(`${variables.flagIds.length} flags updated`);
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err: Error) => {
      toast.error(`Bulk action failed: ${err.message}`);
    },
  });
}
```

- [ ] **Step 5: Verify types compile**

Run: `cd src/ui/frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/randallnoval/Code/agent-feed
git add src/ui/frontend/src/hooks/
git commit -m "feat(ui): add TanStack Query hooks and flag mutations"
```

---

## Task 5: App shell and layout components

**Files:**
- Create: `src/ui/frontend/src/App.tsx`
- Create: `src/ui/frontend/src/components/layout/shell.tsx`
- Create: `src/ui/frontend/src/components/layout/filter-bar.tsx`

- [ ] **Step 1: Create `src/ui/frontend/src/components/layout/filter-bar.tsx`**

```tsx
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
```

- [ ] **Step 2: Create `src/ui/frontend/src/components/layout/shell.tsx`**

```tsx
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
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
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

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {/* Mobile header */}
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
```

- [ ] **Step 3: Create `src/ui/frontend/src/App.tsx`**

```tsx
import { Shell } from "@/components/layout/shell";
import { SessionList } from "@/components/sessions/session-list";
import { SessionDetail } from "@/components/sessions/session-detail";
import { TrendView } from "@/components/trends/trend-view";
import { useSessions } from "@/hooks/use-sessions";
import { useState } from "react";

function getDefaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export default function App() {
  const [view, setView] = useState("sessions");
  const [agent, setAgent] = useState("all");
  const [dateFrom, setDateFrom] = useState(getDefaultDateFrom);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const agentFilter = agent === "all" ? undefined : agent;
  const { data: sessions = [], isLoading: sessionsLoading } = useSessions(agentFilter, dateFrom);

  const sidebar =
    view === "sessions" ? (
      <SessionList
        sessions={sessions}
        isLoading={sessionsLoading}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => {
          setActiveSessionId(id);
          setView("sessions");
        }}
      />
    ) : null;

  const mainContent =
    view === "trends" ? (
      <TrendView agent={agentFilter} dateFrom={dateFrom} onSelectSession={(id) => {
        setActiveSessionId(id);
        setView("sessions");
      }} />
    ) : activeSessionId ? (
      <SessionDetail sessionId={activeSessionId} />
    ) : (
      <EmptyState />
    );

  return (
    <Shell
      currentView={view}
      onViewChange={setView}
      agent={agent}
      dateFrom={dateFrom}
      onAgentChange={setAgent}
      onDateChange={setDateFrom}
      sidebar={sidebar}
    >
      {mainContent}
    </Shell>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20 text-muted-foreground">
      <p className="text-[15px] text-foreground mb-2">No session selected</p>
      <p className="text-sm">
        Select a session from the sidebar to review
        <br />
        decisions, assumptions, and architectural choices.
      </p>
    </div>
  );
}
```

Note: `App.tsx` imports `SessionList`, `SessionDetail`, and `TrendView` which don't exist yet. We'll create stub files so the project compiles, then implement them in the next tasks.

- [ ] **Step 4: Create stub components so the project compiles**

Create `src/ui/frontend/src/components/sessions/session-list.tsx`:

```tsx
import type { Session } from "@/api/types";

interface SessionListProps {
  sessions: Session[];
  isLoading: boolean;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function SessionList({ sessions, isLoading, activeSessionId, onSelectSession }: SessionListProps) {
  if (isLoading) {
    return <div className="p-4 text-xs text-muted-foreground font-mono">loading...</div>;
  }
  if (!sessions.length) {
    return <div className="p-6 text-center text-sm text-muted-foreground">No sessions yet.</div>;
  }
  return (
    <div className="py-1">
      {sessions.map((s) => (
        <button
          key={s.session_id}
          onClick={() => onSelectSession(s.session_id)}
          className={`w-full text-left px-4 py-3 border-l-2 transition-colors
            ${s.session_id === activeSessionId
              ? "border-l-primary bg-accent"
              : "border-l-transparent hover:bg-accent/50"}`}
        >
          <div className="font-mono text-xs text-primary truncate">{s.repo || s.session_id}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2">
            <span>{s.agent}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
```

Create `src/ui/frontend/src/components/sessions/session-detail.tsx`:

```tsx
interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  return <div className="text-sm text-muted-foreground">Session: {sessionId} (implementing next)</div>;
}
```

Create `src/ui/frontend/src/components/trends/trend-view.tsx`:

```tsx
interface TrendViewProps {
  agent?: string;
  dateFrom?: string;
  onSelectSession: (id: string) => void;
}

export function TrendView({ agent, dateFrom, onSelectSession }: TrendViewProps) {
  return <div className="text-sm text-muted-foreground">Trends view (implementing later)</div>;
}
```

- [ ] **Step 5: Verify the project compiles and renders**

Run: `cd src/ui/frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/randallnoval/Code/agent-feed
git add src/ui/frontend/src/App.tsx src/ui/frontend/src/components/layout/ \
  src/ui/frontend/src/components/sessions/ src/ui/frontend/src/components/trends/
git commit -m "feat(ui): add app shell, layout, and stub view components"
```

---

## Task 6: Session list component

**Files:**
- Modify: `src/ui/frontend/src/components/sessions/session-list.tsx`

- [ ] **Step 1: Replace the stub `session-list.tsx` with the full implementation**

```tsx
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { Session } from "@/api/types";

interface SessionListProps {
  sessions: Session[];
  isLoading: boolean;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function SessionList({
  sessions,
  isLoading,
  activeSessionId,
  onSelectSession,
}: SessionListProps) {
  const [search, setSearch] = useState("");

  const filtered = search
    ? sessions.filter(
        (s) =>
          (s.repo ?? "").toLowerCase().includes(search) ||
          s.session_id.toLowerCase().includes(search) ||
          (s.agent ?? "").toLowerCase().includes(search),
      )
    : sessions;

  return (
    <>
      <div className="p-2 px-3 border-b border-border">
        <Input
          type="text"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => setSearch(e.target.value.toLowerCase())}
          className="h-8 text-xs"
        />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground font-mono">loading...</div>
        ) : !filtered.length ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {search ? "No matching sessions." : "No sessions yet."}
          </div>
        ) : (
          filtered.map((s) => (
            <button
              key={s.session_id}
              onClick={() => onSelectSession(s.session_id)}
              className={`w-full text-left px-4 py-3 border-l-2 transition-colors cursor-pointer
                ${
                  s.session_id === activeSessionId
                    ? "border-l-primary bg-accent"
                    : "border-l-transparent hover:bg-accent/50"
                }`}
            >
              <div className="font-mono text-xs text-primary truncate">
                {s.repo || s.session_id}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                <span>{s.agent || ""}</span>
                <span>{formatDate(s.latest_timestamp)}</span>
                {s.repo && (
                  <span className="font-mono text-[10px]">
                    {s.session_id.slice(0, 12)}&hellip;
                  </span>
                )}
              </div>
              <div className="flex gap-2 mt-1">
                {s.unreviewed_flags > 0 ? (
                  <Badge variant="secondary" className="text-[10px] font-mono bg-primary/10 text-primary">
                    {s.unreviewed_flags} unreviewed
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] font-mono bg-green-500/10 text-green-400">
                    reviewed
                  </Badge>
                )}
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {s.turn_count} turn{s.turn_count !== 1 ? "s" : ""}
                </Badge>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd src/ui/frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
cd /Users/randallnoval/Code/agent-feed
git add src/ui/frontend/src/components/sessions/session-list.tsx
git commit -m "feat(ui): implement session list with search and badges"
```

---

## Task 7: Flag card component

**Files:**
- Create: `src/ui/frontend/src/components/flags/flag-card.tsx`

- [ ] **Step 1: Create `src/ui/frontend/src/components/flags/flag-card.tsx`**

```tsx
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFlagColors, cn } from "@/lib/utils";
import type { Flag, ReviewStatus } from "@/api/types";

interface FlagCardProps {
  flag: Flag;
  onStatusChange: (flagId: string, status: ReviewStatus) => void;
  onSaveNotes: (flagId: string, note: string | null, outcome: string | null) => void;
}

const STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: "accepted", label: "accept" },
  { value: "needs_change", label: "needs change" },
  { value: "false_positive", label: "false positive" },
];

const STATUS_STYLES: Record<string, string> = {
  accepted: "border-green-500 text-green-400 bg-green-500/10",
  needs_change: "border-yellow-500 text-yellow-400 bg-yellow-500/10",
  false_positive: "border-red-500 text-red-400 bg-red-500/10",
};

export function FlagCard({ flag, onStatusChange, onSaveNotes }: FlagCardProps) {
  const [note, setNote] = useState(flag.reviewer_note ?? "");
  const [outcome, setOutcome] = useState(flag.outcome ?? "");
  const colors = getFlagColors(flag.type);

  return (
    <Card className={cn("border-l-4 rounded-none border-b border-border shadow-none", colors.border)}>
      <CardContent className="p-3 px-4 space-y-2">
        {/* Header */}
        <div className="flex justify-between items-center">
          <Badge
            variant="outline"
            className={cn(
              "font-mono text-[10px] uppercase tracking-wider rounded-sm",
              colors.bg,
              colors.text,
            )}
          >
            {flag.type}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">
            {Math.round(flag.confidence * 100)}% confidence
          </span>
        </div>

        {/* Content */}
        <p className="text-sm font-medium leading-relaxed">{flag.content}</p>

        {/* Context */}
        {flag.context && (
          <div className="text-xs text-muted-foreground italic bg-muted p-3 border-l-2 border-border rounded-r-sm leading-relaxed">
            {flag.context}
          </div>
        )}

        {/* Status buttons */}
        <div className="flex gap-2 flex-wrap">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              variant="outline"
              size="sm"
              className={cn(
                "font-mono text-[11px] h-7",
                flag.review_status === value && STATUS_STYLES[value],
              )}
              onClick={() => onStatusChange(flag.id, value)}
            >
              {label}
            </Button>
          ))}
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Input
            placeholder="Reviewer note..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8 text-xs"
          />
          <Input
            placeholder="Outcome..."
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="h-8 text-xs"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              className="font-mono text-[11px] h-7"
              onClick={() =>
                onSaveNotes(flag.id, note || null, outcome || null)
              }
            >
              save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd src/ui/frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
cd /Users/randallnoval/Code/agent-feed
git add src/ui/frontend/src/components/flags/
git commit -m "feat(ui): implement flag card with inline context and review actions"
```

---

## Task 8: Session detail and turn block components

**Files:**
- Modify: `src/ui/frontend/src/components/sessions/session-detail.tsx`
- Create: `src/ui/frontend/src/components/sessions/turn-block.tsx`

- [ ] **Step 1: Create `src/ui/frontend/src/components/sessions/turn-block.tsx`**

```tsx
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
    if (rawVisible) {
      setRawVisible(false);
      return;
    }
    if (rawContent === null) {
      setRawLoading(true);
      try {
        const data = await fetchRawRecord(sessionId, record.id);
        let pretty = data.raw_response;
        try {
          pretty = JSON.stringify(JSON.parse(data.raw_response), null, 2);
        } catch {
          // Not valid JSON, use as-is
        }
        setRawContent(pretty);
      } catch {
        setRawContent("Failed to load raw response");
      }
      setRawLoading(false);
    }
    setRawVisible(true);
  }

  const flags = record.flags ?? [];

  return (
    <Card className="mb-4 overflow-hidden">
      {/* Turn header */}
      <div className="px-3.5 py-2 bg-muted border-b border-border flex justify-between items-center">
        <span className="font-mono text-[11px] text-muted-foreground">
          Turn {record.turn_index} &middot; {formatTime(record.timestamp)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-[11px] text-muted-foreground h-6 px-2"
          onClick={toggleRaw}
        >
          [ raw ]
        </Button>
      </div>

      {/* Summary */}
      <div className="px-3.5 py-2.5 text-sm text-muted-foreground border-b border-border">
        {record.response_summary}
      </div>

      {/* Flags */}
      {flags.length > 0 ? (
        flags.map((f) => (
          <FlagCard
            key={f.id}
            flag={f}
            onStatusChange={onFlagStatusChange}
            onSaveNotes={onSaveNotes}
          />
        ))
      ) : (
        <div className="px-3.5 py-2.5 text-xs text-muted-foreground">
          No flags extracted
        </div>
      )}

      {/* Raw response */}
      {rawVisible && (
        <div className="mx-3.5 mb-3.5 mt-2 bg-muted border border-border rounded-sm p-3 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap overflow-x-auto max-h-72 overflow-y-auto">
          {rawLoading ? "loading..." : rawContent}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Replace `session-detail.tsx` with full implementation**

```tsx
import { useSession } from "@/hooks/use-session";
import { useUpdateFlagStatus, useSaveNotes, useBulkUpdate } from "@/hooks/use-flag-mutations";
import { TurnBlock } from "./turn-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/lib/utils";
import type { ReviewStatus } from "@/api/types";

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const { data: records, isLoading, error } = useSession(sessionId);
  const updateStatus = useUpdateFlagStatus(sessionId);
  const saveNotes = useSaveNotes(sessionId);
  const bulkUpdate = useBulkUpdate(sessionId);

  if (isLoading) {
    return <div className="p-10 text-center font-mono text-xs text-muted-foreground">loading session...</div>;
  }
  if (error || !records?.length) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Session not found.</div>;
  }

  const allFlags = records.flatMap((r) => r.flags ?? []);
  const unreviewed = allFlags.filter((f) => f.review_status === "unreviewed");
  const accepted = allFlags.filter((f) => f.review_status === "accepted").length;
  const needsChange = allFlags.filter((f) => f.review_status === "needs_change").length;
  const falsePos = allFlags.filter((f) => f.review_status === "false_positive").length;
  const first = records[0];

  function handleBulk(status: ReviewStatus) {
    const ids = unreviewed.map((f) => f.id);
    if (!ids.length) return;
    if (!confirm(`Update ${ids.length} flags to "${status.replace("_", " ")}"?`)) return;
    bulkUpdate.mutate({ flagIds: ids, status });
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-5 pb-4 border-b border-border">
        <h1 className="text-base font-semibold">{first.repo || sessionId}</h1>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          {first.agent} &middot; {first.model} &middot; {formatDate(first.timestamp)}
          {first.git_branch ? ` \u00b7 ${first.git_branch}` : ""}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3 mb-5">
        <StatCard value={allFlags.length} label="total flags" />
        <StatCard value={unreviewed.length} label="unreviewed" className={unreviewed.length > 0 ? "text-yellow-400" : ""} />
        <StatCard value={accepted} label="accepted" className="text-green-400" />
        <StatCard value={needsChange} label="needs change" className="text-yellow-400" />
        <StatCard value={falsePos} label="false positive" className="text-red-400" />
        <StatCard value={records.length} label="turns" />
      </div>

      {/* Bulk actions */}
      {unreviewed.length > 0 && (
        <div className="flex gap-2 items-center mb-4 p-3 px-4 bg-muted border border-border rounded-md">
          <span className="text-sm text-muted-foreground">
            {unreviewed.length} unreviewed flags
          </span>
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-[11px] h-7 border-green-500 text-green-400 bg-green-500/10"
            onClick={() => handleBulk("accepted")}
          >
            accept all
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-[11px] h-7 border-red-500 text-red-400"
            onClick={() => handleBulk("false_positive")}
          >
            mark all FP
          </Button>
        </div>
      )}

      {/* Turn blocks */}
      {records.map((r) => (
        <TurnBlock
          key={r.id}
          record={r}
          sessionId={sessionId}
          onFlagStatusChange={(flagId, status) => updateStatus.mutate({ flagId, status })}
          onSaveNotes={(flagId, note, outcome) =>
            saveNotes.mutate({ flagId, reviewerNote: note, outcome })
          }
        />
      ))}
    </div>
  );
}

function StatCard({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div className="bg-muted border border-border rounded-md p-3 px-4">
      <div className={`font-mono text-xl font-medium leading-tight ${className ?? ""}`}>{value}</div>
      <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd src/ui/frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
cd /Users/randallnoval/Code/agent-feed
git add src/ui/frontend/src/components/sessions/session-detail.tsx \
  src/ui/frontend/src/components/sessions/turn-block.tsx
git commit -m "feat(ui): implement session detail with turn blocks and flag cards"
```

---

## Task 9: Trends view component

**Files:**
- Modify: `src/ui/frontend/src/components/trends/trend-view.tsx`

- [ ] **Step 1: Replace `trend-view.tsx` with full implementation**

```tsx
import { useTrends } from "@/hooks/use-trends";
import { getFlagColors } from "@/lib/utils";

interface TrendViewProps {
  agent?: string;
  dateFrom?: string;
  onSelectSession: (id: string) => void;
}

export function TrendView({ agent, dateFrom, onSelectSession }: TrendViewProps) {
  const { data, isLoading, error } = useTrends({ agent, dateFrom });

  if (isLoading) {
    return <div className="p-10 text-center font-mono text-xs text-muted-foreground">loading trends...</div>;
  }
  if (error || !data) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Failed to load trends.</div>;
  }

  const maxCount = Math.max(...data.by_type.map((t) => t.count), 1);

  return (
    <div>
      {/* Header */}
      <div className="mb-5 pb-4 border-b border-border">
        <h1 className="text-base font-semibold">Trends</h1>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          {data.total_flags} total flags across {data.by_session.length} sessions
        </p>
      </div>

      {/* By type */}
      <div className="mb-5">
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
          By Type
        </div>
        {data.by_type.length > 0 ? (
          data.by_type.map((t) => {
            const pct = Math.round((t.count / maxCount) * 100);
            const fpPct = Math.round(t.false_positive_rate * 100);
            const colors = getFlagColors(t.type);
            return (
              <div key={t.type} className="flex items-center gap-2 mb-1.5">
                <span className={`font-mono text-[11px] w-24 shrink-0 ${colors.text}`}>
                  {t.type}
                </span>
                <div className="flex-1 bg-muted rounded-sm h-2 overflow-hidden">
                  <div
                    className="h-full rounded-sm transition-all duration-300"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: `var(--color-flag-${t.type}, var(--primary))`,
                    }}
                  />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground w-7 text-right">
                  {t.count}
                </span>
                <span className="font-mono text-[10px] text-red-400 w-9 text-right">
                  {fpPct > 0 ? `${fpPct}%fp` : ""}
                </span>
              </div>
            );
          })
        ) : (
          <div className="text-xs text-muted-foreground">No flags yet</div>
        )}
      </div>

      {/* By session */}
      <div>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
          By Session
        </div>
        {data.by_session.length > 0 ? (
          data.by_session.map((s) => (
            <button
              key={s.session_id}
              onClick={() => onSelectSession(s.session_id)}
              className="w-full py-2 border-b border-border/50 cursor-pointer flex justify-between items-center transition-colors hover:text-primary"
            >
              <span className="font-mono text-[11px] text-primary truncate max-w-[200px]">
                {s.repo || s.session_id}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {s.flag_count ?? 0} flags
              </span>
            </button>
          ))
        ) : (
          <div className="text-xs text-muted-foreground">No sessions yet</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd src/ui/frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
cd /Users/randallnoval/Code/agent-feed
git add src/ui/frontend/src/components/trends/
git commit -m "feat(ui): implement trends view with type bars and session list"
```

---

## Task 10: Update server.js — strip buildHTML, serve static dist

**Files:**
- Modify: `src/ui/server.js`
- Modify: `test/ui.test.js`

- [ ] **Step 1: Rewrite `src/ui/server.js`**

Replace the entire file with the following. This keeps all API routes identical and adds static file serving for the built frontend:

```js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'frontend', 'dist');

const VALID_REVIEW_STATUSES = ['unreviewed', 'accepted', 'needs_change', 'false_positive'];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'content-type': mime });
    res.end(content);
  } catch {
    return false;
  }
  return true;
}

export function createUIServer({ db }) {
  let server = null;
  let _port = null;

  async function handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost`);
    const pathname = url.pathname;
    const method = req.method;

    // ── API routes ──────────────────────────────────────────────────────

    if (method === 'GET' && pathname === '/api/trends') {
      const agent    = url.searchParams.get('agent')    || undefined;
      const repo     = url.searchParams.get('repo')     || undefined;
      const branch   = url.searchParams.get('branch')   || undefined;
      const dateFrom = url.searchParams.get('dateFrom') || undefined;
      const dateTo   = url.searchParams.get('dateTo')   || undefined;
      const trends = await db.getTrends({ agent, repo, branch, dateFrom, dateTo });
      return json(res, 200, trends);
    }

    if (method === 'GET' && pathname === '/api/sessions') {
      const agentFilter = url.searchParams.get('agent');
      const dateFilter = url.searchParams.get('date');
      let sessions = await db.listSessions();
      if (agentFilter) sessions = sessions.filter(s => s.agent === agentFilter);
      if (dateFilter) sessions = sessions.filter(s => s.latest_timestamp >= dateFilter);
      const flagCounts = await db.getSessionFlagCounts();
      const countsMap = new Map(flagCounts.map(c => [c.session_id, c]));
      for (const s of sessions) {
        const counts = countsMap.get(s.session_id);
        s.total_flags = counts?.total_flags ?? 0;
        s.unreviewed_flags = counts?.unreviewed_flags ?? 0;
      }
      return json(res, 200, sessions);
    }

    const rawMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/records\/([^/]+)\/raw$/);
    if (method === 'GET' && rawMatch) {
      const sessionId = decodeURIComponent(rawMatch[1]);
      const recordId = decodeURIComponent(rawMatch[2]);
      const records = await db.getSession(sessionId);
      const record = records.find(r => r.id === recordId);
      if (!record) return json(res, 404, { error: 'Record not found' });
      return json(res, 200, { raw_response: record.raw_response, raw_request: record.raw_request });
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (method === 'GET' && sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const records = await db.getRecordsWithFlags(sessionId);
      if (!records.length) return json(res, 404, { error: 'Session not found' });
      return json(res, 200, records);
    }

    if (method === 'PATCH' && pathname === '/api/flags/bulk') {
      const body = await readBody(req);
      const { flag_ids, review_status } = body;
      if (!Array.isArray(flag_ids) || !flag_ids.length || !flag_ids.every(id => typeof id === 'string' && id.length > 0)) {
        return json(res, 400, { error: 'flag_ids must be a non-empty array of strings' });
      }
      if (!review_status || !VALID_REVIEW_STATUSES.includes(review_status)) {
        return json(res, 400, { error: `Invalid review_status: ${review_status}` });
      }
      try {
        await db.bulkUpdateFlagReview(flag_ids, review_status);
        return json(res, 200, { ok: true, updated: flag_ids.length });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    const flagMatch = pathname.match(/^\/api\/flags\/([^/]+)$/);
    if (method === 'PATCH' && flagMatch) {
      const flagId = decodeURIComponent(flagMatch[1]);
      const body = await readBody(req);
      const { review_status, reviewer_note, outcome } = body;
      if (review_status && !VALID_REVIEW_STATUSES.includes(review_status)) {
        return json(res, 400, { error: `Invalid review_status: ${review_status}` });
      }
      try {
        await db.updateFlagReview(flagId, { review_status, reviewer_note, outcome });
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    // ── Static file serving ─────────────────────────────────────────────

    if (method === 'GET') {
      // Try exact file path first
      const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(DIST_DIR, safePath);
      if (filePath.startsWith(DIST_DIR) && serveStatic(res, filePath)) return;

      // SPA fallback: serve index.html for non-API, non-file routes
      const indexPath = path.join(DIST_DIR, 'index.html');
      if (serveStatic(res, indexPath)) return;

      // No dist/ built yet
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('Frontend not built. Run: cd src/ui/frontend && npm run build');
      return;
    }

    json(res, 404, { error: 'Not found' });
  }

  const instance = {
    get port() { return _port; },

    async listen(configPort = 3000) {
      server = http.createServer((req, res) => {
        handleRequest(req, res).catch(err => json(res, 500, { error: err.message }));
      });
      await new Promise((resolve, reject) => {
        server.listen(configPort, 'localhost', (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      _port = server.address().port;
    },

    async close() {
      if (!server) return;
      await new Promise((resolve) => server.close(resolve));
      server = null;
    },
  };

  return instance;
}
```

- [ ] **Step 2: Update `test/ui.test.js` — fix the `GET /` test**

The `GET /` test previously checked for `<!DOCTYPE html>` from `buildHTML()`. Now it should check that the server either serves the built `index.html` (if `dist/` exists) or returns 503 (if not). Replace the `describe('GET /', ...)` block:

```js
  describe('GET /', () => {
    it('serves a response for the root route', async () => {
      const res = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: 'localhost', port, path: '/' }, res => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
        });
        req.on('error', reject);
        req.end();
      });
      // Either serves built frontend (200) or returns 503 if dist/ not built
      assert.ok([200, 503].includes(res.status));
      if (res.status === 200) {
        assert.ok(res.headers['content-type']?.includes('text/html'));
      }
    });
  });
```

- [ ] **Step 3: Run backend tests to verify nothing is broken**

Run: `npm test`
Expected: All tests pass (110 tests, 0 failures). The API route tests are unchanged. The `GET /` test now accepts 503 when `dist/` doesn't exist.

- [ ] **Step 4: Commit**

```bash
cd /Users/randallnoval/Code/agent-feed
git add src/ui/server.js test/ui.test.js
git commit -m "refactor(ui): strip buildHTML, serve static dist from Vite build"
```

---

## Task 11: Build, verify, and test the full integration

**Files:**
- No new files. This task verifies everything works end-to-end.

- [ ] **Step 1: Build the frontend**

Run: `cd src/ui/frontend && npm run build`
Expected: `dist/` directory created with `index.html`, JS bundle, and CSS.

- [ ] **Step 2: Run backend tests again with dist/ present**

Run: `cd /Users/randallnoval/Code/agent-feed && npm test`
Expected: All tests pass. The `GET /` test now returns 200 with `text/html`.

- [ ] **Step 3: Restart the daemon and verify**

```bash
agent-feed stop
agent-feed start
```

Expected: Daemon starts, UI available at http://localhost:3000.

- [ ] **Step 4: Manual verification in browser**

Open http://localhost:3000 and verify:
- Sessions list loads in sidebar with recent sessions
- Default date filter shows last 7 days
- Clicking a session shows the detail view with stat cards, turn blocks, and flag cards
- Flag cards show type badge, content, context (for newly captured sessions), and action buttons
- Clicking "accept" / "needs change" / "false positive" updates the flag
- Typing a note and clicking "save" persists the note
- Switching to Trends tab shows the trends view
- Mobile responsive: narrow the browser and verify the hamburger menu works

- [ ] **Step 5: Commit the build output (optional — or add to .gitignore)**

The `dist/` directory is already in `.gitignore`, so the daemon needs a build step. This is by design — the daemon can auto-build on first start (future enhancement). No commit needed.

- [ ] **Step 6: Final commit — update CLAUDE.md if needed**

If any architectural notes need updating in `CLAUDE.md` (e.g., the UI section), update it now.

```bash
git add -A
git commit -m "feat(ui): complete frontend migration to Vite + React + shadcn/ui"
```
