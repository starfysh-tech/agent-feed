# Frontend Migration: Vite + React + shadcn/ui

**Date:** 2026-04-21
**Status:** Approved
**Scope:** Replace the inline `buildHTML()` UI with a proper SPA

## Context

The current UI is an 866-line `buildHTML()` function in `src/ui/server.js` that generates HTML via template string concatenation with manual XSS escaping (`esc()`, `escAttr()`). This approach has reached its limits:

- 13 `innerHTML` assignments, each a manual security audit surface
- No hot-reload — daemon restart required for any UI change
- No component boundaries — all rendering is loose functions in a single file
- Adding features (context field, layout changes) is increasingly fragile

The dashboard serves a specific purpose: **multi-agent oversight**. The user monitors Claude Code, Gemini, and other agents across multiple repos, reviewing flagged decisions/assumptions to either confirm they're appropriate or identify improvements to prompting/CLAUDE.md/rules.

The workflow is both **immediate** (fix a bad decision now) and **pattern-based** (spot systemic issues across sessions to tune agent behavior).

## Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Build | Vite | Zero config, instant HMR, native ESM |
| Framework | React | Largest ecosystem, most "muscle memory" for returning to code after weeks away |
| Components | shadcn/ui | Copy-pasted Radix primitives — no dependency, no version lock-in, accessible by default |
| Styling | Tailwind CSS | Replaces inline `<style>` block; utilities compose with shadcn; no custom CSS needed |
| Data fetching | TanStack Query | Auto-refetch on focus, optimistic updates, cache invalidation |
| Tables | TanStack Table (via shadcn DataTable) | Session/flag lists need sorting, filtering |

**No custom CSS.** Every element is shadcn components + Tailwind utilities. The only styling decisions are Tailwind classes (e.g., `border-l-purple-500` for flag type colors).

## Project Structure

```
src/ui/
  server.js              <- API routes only (~150 lines, stripped of buildHTML)
  frontend/
    index.html
    vite.config.ts
    tailwind.config.ts
    tsconfig.json
    package.json         <- frontend-only deps
    src/
      main.tsx
      App.tsx
      api/               <- fetch wrappers (sessions, flags, trends)
      components/
        layout/          <- Shell, Sidebar, Header
        sessions/        <- SessionList, SessionDetail
        flags/           <- FlagCard, FlagActions, FlagNotes
        trends/          <- TrendView
        ui/              <- shadcn components (copied in, not imported)
      hooks/             <- TanStack Query hooks
      lib/
        utils.ts         <- cn() helper, date formatters
      styles/
        globals.css      <- Tailwind base + design tokens as CSS vars
```

**Separate `package.json`** for the frontend keeps the backend lean. Root `npm test` still runs backend tests only. Frontend has its own `npm run dev` / `npm run build`.

## Views

### Sessions (main view)

Sidebar/detail split layout:

- **Left sidebar**: Session list as a DataTable with columns for repo, agent, date, turn count, unreviewed badge. Sortable. Agent and date filters in a FilterBar above the list. Search input for quick session lookup.
- **Right panel**: Selected session's turn-by-turn timeline. Each turn shows timestamp, response summary, and flag cards.

### Trends

Aggregated flag data across sessions. Same filters (agent, date range) as the sessions view. Shows flag type distribution, confidence breakdowns, review status summary.

### Navigation

Minimal top bar with Tabs (Sessions | Trends). Global filters (agent Select, date DatePicker) in the FilterBar below tabs. Filters persist across view switches. Filter state stored in URL search params (survives refresh, shareable).

## Flag Card Design

Inline context layout — all information visible without interaction:

```
+--[border-l-{type-color}]------------------------------------------+
| [DECISION badge]                              [95% confidence]     |
| Binary search algorithm for sorting                                |
|                                                                    |
| | Agent chose binary search over linear search, assuming the       |
| | input array is pre-sorted. Selected for O(log n) performance.   |
|                                                                    |
| [accept] [needs change] [false positive]                           |
|                                                                    |
| [Reviewer note...                                                ] |
| [Outcome...                                                      ] |
|                                                        [save]      |
+--------------------------------------------------------------------+
```

**shadcn composition:**
- `Card` + `CardContent` for container
- `Badge` (variant=outline) for flag type
- Context block: Tailwind utilities only (`text-sm text-muted-foreground italic bg-muted p-3 border-l-2`)
- `Button` (variant=outline, size=sm) for status actions
- `Input` for reviewer note and outcome
- `Button` for save

**Flag type colors** mapped via a single Tailwind class per type (e.g., `border-l-purple-500` for decision, `border-l-amber-500` for assumption).

## Data Flow

### TanStack Query hooks

| Hook | Endpoint | Refetch |
|------|----------|---------|
| `useSessions(agent, dateFrom)` | `GET /api/sessions?agent=&date=` | On focus, on filter change |
| `useSession(id)` | `GET /api/sessions/:id` | On focus, after flag mutation |
| `useTrends(filters)` | `GET /api/trends?...` | On focus, on filter change |

### Mutations

| Action | Endpoint | Optimistic update |
|--------|----------|-------------------|
| Set flag status | `PATCH /api/flags/:id` | Update status in cache, invalidate session |
| Save notes | `PATCH /api/flags/:id` | Update note/outcome in cache, invalidate session |
| Bulk update | `POST /api/flags/bulk` | Invalidate session |

### State

Almost no client-side state. TanStack Query owns all server state.

Local state (React `useState`):
- `activeSessionId` — selected session

All other state (current view, agent filter, date filter) stored in URL search params via `useSearchParams`. This means the current tab, filters, and selected session survive page refresh and can be bookmarked.

No state management library. No context providers beyond `QueryClientProvider`.

## API Changes

**None.** All existing endpoints stay identical:

| Method | Path | Unchanged |
|--------|------|-----------|
| GET | `/api/sessions` | Yes (date filter already uses `>=`) |
| GET | `/api/sessions/:id` | Yes |
| GET | `/api/sessions/:id/records/:id/raw` | Yes |
| PATCH | `/api/flags/:id` | Yes |
| POST | `/api/flags/bulk` | Yes |
| GET | `/api/trends` | Yes |

## Dev Workflow

### Development

```bash
cd src/ui/frontend && npm run dev
```

Vite dev server on port 5173, proxies `/api/*` to the daemon on port 3000. HMR for instant feedback.

### Production (daemon mode)

`server.js` serves `frontend/dist/` as static files for non-API routes. `agent-feed start` checks for `dist/` and runs the build if absent.

### Root package.json additions

```json
"scripts": {
  "dev:ui": "cd src/ui/frontend && npm run dev",
  "build:ui": "cd src/ui/frontend && npm run build"
}
```

## What Gets Deleted

- `buildHTML()` and all inline CSS/JS (~700 lines from `server.js`)
- `esc()`, `escAttr()` helpers (JSX handles escaping structurally)
- Client-side JS functions: `renderFlag`, `renderTurn`, `renderSessionList`, `renderSessionDetail`, `loadSessions`, `loadTrends`, `selectSession`, `setStatus`, `saveNotes`, `toggleRaw`, `getFilteredSessions`, `navigateSession`, `showCommandPalette`

`server.js` shrinks from ~866 lines to ~150 (API routes + static file serving).

## What Stays Unchanged

- All API routes in `server.js`
- `storage/database.js`
- `classifier/index.js`
- `pipeline.js`
- `proxy/index.js`
- `adapters/index.js`
- All backend tests
- Daemon lifecycle (supervisor, PID, start/stop)

## Migration Strategy

Clean swap — the current `buildHTML()` is monolithic and can't be partially migrated. Risk is low:

1. Scaffold Vite + React + Tailwind + shadcn in `src/ui/frontend/`
2. Build the shell (layout, sidebar, tabs, filter bar)
3. Build sessions view (list + detail with flag cards)
4. Build trends view
5. Wire up TanStack Query hooks to existing API
6. Update `server.js` to serve `dist/` and strip `buildHTML()`
7. Verify daemon mode works with built assets

**Rollback**: `buildHTML()` stays in git history. One `git revert` restores it.

## Testing

- **Frontend**: No unit tests for v1. Components are mostly shadcn primitives (tested upstream). Manual verification against the running daemon.
- **Backend**: All existing tests continue passing — API layer is unchanged.

## Keyboard Shortcuts

Reimplemented as event listeners in the shell component:

- `j/k` — navigate session list
- `Cmd+K` — command palette / quick session search

Not a priority for v1 but the component structure supports it.
