# Anti-Pattern Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 detected anti-patterns (error suppression, sequential async, N+1 queries, innerHTML) across 4 source files

**Architecture:** Add batch DB methods to eliminate N+1 loops, extract shared eval sample-collection logic, add error logging to fire-and-forget paths, and document the innerHTML `esc()` convention. All changes preserve existing behavior and pass existing tests.

**Tech Stack:** Node.js (ESM), sql.js, node:test

---

### Task 1: Add batch DB methods (`getSessionFlagCounts`, `getRecordsWithFlags`)

These new methods eliminate the N+1 query loops in `server.js` and provide batch alternatives for `eval.js`.

**Files:**
- Modify: `src/storage/database.js` (add 2 methods)
- Create: `test/storage-batch.test.js`

- [ ] **Step 1: Write failing test for `getSessionFlagCounts`**

```javascript
// test/storage-batch.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/storage/database.js';

describe('Database batch methods', () => {
  let tmpDir, db;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-batch-'));
    db = new Database(path.join(tmpDir, 'batch.db'));
    await db.init();

    // Seed: 2 sessions, each with records and flags
    const r1 = await db.insertRecord({
      timestamp: '2026-03-29T10:00:00Z', agent: 'claude-code',
      session_id: 'sess-a', turn_index: 1, working_directory: '/tmp',
      response_summary: 'turn 1', raw_response: '{}', model: 'claude-sonnet-4-6',
    });
    await db.insertFlag({ record_id: r1, type: 'decision', content: 'use jwt', confidence: 0.9 });
    await db.insertFlag({ record_id: r1, type: 'assumption', content: 'docker ok', confidence: 0.8 });

    const r2 = await db.insertRecord({
      timestamp: '2026-03-29T10:01:00Z', agent: 'claude-code',
      session_id: 'sess-a', turn_index: 2, working_directory: '/tmp',
      response_summary: 'turn 2', raw_response: '{}', model: 'claude-sonnet-4-6',
    });
    const flagId = await db.insertFlag({ record_id: r2, type: 'risk', content: 'no tests', confidence: 0.7 });
    await db.updateFlagReview(flagId, { review_status: 'accepted' });

    const r3 = await db.insertRecord({
      timestamp: '2026-03-29T10:02:00Z', agent: 'codex',
      session_id: 'sess-b', turn_index: 1, working_directory: '/tmp',
      response_summary: 'turn 1', raw_response: '{}', model: 'gpt-4',
    });
    await db.insertFlag({ record_id: r3, type: 'decision', content: 'use mongo', confidence: 0.85 });
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('getSessionFlagCounts returns total and unreviewed per session', async () => {
    const counts = await db.getSessionFlagCounts();
    const sessA = counts.find(c => c.session_id === 'sess-a');
    const sessB = counts.find(c => c.session_id === 'sess-b');

    assert.ok(sessA, 'sess-a should be present');
    assert.equal(sessA.total_flags, 3);
    assert.equal(sessA.unreviewed_flags, 2); // 1 accepted, 2 unreviewed

    assert.ok(sessB, 'sess-b should be present');
    assert.equal(sessB.total_flags, 1);
    assert.equal(sessB.unreviewed_flags, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/storage-batch.test.js`
Expected: FAIL — `db.getSessionFlagCounts is not a function`

- [ ] **Step 3: Implement `getSessionFlagCounts` in database.js**

Add this method to the `Database` class in `src/storage/database.js`, after the `getTrends` method:

```javascript
async getSessionFlagCounts() {
  const result = this.db.exec(
    `SELECT
      r.session_id,
      COUNT(f.id) as total_flags,
      SUM(CASE WHEN f.review_status = 'unreviewed' THEN 1 ELSE 0 END) as unreviewed_flags
     FROM records r
     LEFT JOIN flags f ON f.record_id = r.id
     GROUP BY r.session_id`
  );
  if (!result.length) return [];
  return this._rowsToObjects(result[0]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/storage-batch.test.js`
Expected: PASS

- [ ] **Step 5: Write failing test for `getRecordsWithFlags`**

Add to the same test file:

```javascript
describe('getRecordsWithFlags', () => {
  it('returns records with flags array attached', async () => {
    const records = await db.getRecordsWithFlags('sess-a');
    assert.equal(records.length, 2);

    const turn1 = records.find(r => r.turn_index === 1);
    assert.ok(Array.isArray(turn1.flags));
    assert.equal(turn1.flags.length, 2);
    assert.equal(turn1.flags[0].type, 'decision');

    const turn2 = records.find(r => r.turn_index === 2);
    assert.equal(turn2.flags.length, 1);
    assert.equal(turn2.flags[0].type, 'risk');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test test/storage-batch.test.js`
Expected: FAIL — `db.getRecordsWithFlags is not a function`

- [ ] **Step 7: Implement `getRecordsWithFlags` in database.js**

Add this method to the `Database` class, after `getSessionFlagCounts`:

```javascript
async getRecordsWithFlags(sessionId) {
  const records = await this.getSession(sessionId);
  if (!records.length) return [];
  const recordIds = records.map(r => r.id);
  const placeholders = recordIds.map(() => '?').join(',');
  const flagResult = this.db.exec(
    `SELECT * FROM flags WHERE record_id IN (${placeholders})`,
    recordIds
  );
  const allFlags = flagResult.length ? this._rowsToObjects(flagResult[0]) : [];
  const flagsByRecord = new Map();
  for (const flag of allFlags) {
    if (!flagsByRecord.has(flag.record_id)) flagsByRecord.set(flag.record_id, []);
    flagsByRecord.get(flag.record_id).push(flag);
  }
  for (const record of records) {
    record.flags = flagsByRecord.get(record.id) || [];
  }
  return records;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test test/storage-batch.test.js`
Expected: PASS

- [ ] **Step 9: Run full test suite**

Run: `npm test`
Expected: All tests pass (no regressions, new tests pass)

- [ ] **Step 10: Commit**

```bash
git add src/storage/database.js test/storage-batch.test.js
git commit -m "feat: add batch DB methods getSessionFlagCounts and getRecordsWithFlags"
```

---

### Task 2: Fix N+1 queries in UI server

Replace the nested `for` loops in `server.js` API handlers with calls to the batch DB methods from Task 1.

**Files:**
- Modify: `src/ui/server.js:390-428`
- Test: `test/ui.test.js` (existing), `test/trends.test.js` (existing)

- [ ] **Step 1: Replace N+1 loop in `GET /api/sessions` handler**

In `src/ui/server.js`, replace lines 396-406:

```javascript
// BEFORE (lines 396-406):
for (const s of sessions) {
  const records = await db.getSession(s.session_id);
  let total = 0, unreviewed = 0;
  for (const r of records) {
    const flags = await db.getFlagsForRecord(r.id);
    total += flags.length;
    unreviewed += flags.filter(f => f.review_status === 'unreviewed').length;
  }
  s.total_flags = total;
  s.unreviewed_flags = unreviewed;
}
```

```javascript
// AFTER:
const flagCounts = await db.getSessionFlagCounts();
const countsMap = new Map(flagCounts.map(c => [c.session_id, c]));
for (const s of sessions) {
  const counts = countsMap.get(s.session_id);
  s.total_flags = counts?.total_flags ?? 0;
  s.unreviewed_flags = counts?.unreviewed_flags ?? 0;
}
```

- [ ] **Step 2: Replace N+1 loop in `GET /api/sessions/:id` handler**

In `src/ui/server.js`, replace lines 423-427:

```javascript
// BEFORE (lines 423-427):
const records = await db.getSession(sessionId);
if (!records.length) return json(res, 404, { error: 'Session not found' });
for (const record of records) {
  record.flags = await db.getFlagsForRecord(record.id);
}
return json(res, 200, records);
```

```javascript
// AFTER:
const records = await db.getRecordsWithFlags(sessionId);
if (!records.length) return json(res, 404, { error: 'Session not found' });
return json(res, 200, records);
```

- [ ] **Step 3: Run existing UI and trends tests**

Run: `node --test test/ui.test.js test/trends.test.js`
Expected: All PASS — API responses are identical

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/ui/server.js
git commit -m "fix: replace N+1 query loops in session API with batch DB methods"
```

---

### Task 3: Fix error suppression in `src/app.js`

The `.catch(() => {})` on `pipeline.process()` silently swallows all pipeline errors. Add logging.

**Files:**
- Modify: `src/app.js:62`
- Test: `test/app.test.js` (existing)

- [ ] **Step 1: Add error logging to pipeline catch**

In `src/app.js`, replace line 62:

```javascript
// BEFORE:
pipeline.process(capture).catch(() => {});
```

```javascript
// AFTER:
pipeline.process(capture).catch((err) => {
  console.error('[agent-feed] pipeline error:', err.message ?? err);
});
```

- [ ] **Step 2: Run existing app tests**

Run: `node --test test/app.test.js`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "fix: log pipeline errors instead of silently swallowing"
```

---

### Task 4: Fix error suppression in `src/eval.js`

There are 4 empty `catch {}` blocks: 2 for JSON.parse (intentional fallback) and 2 for classifierFn (silently lost). The JSON.parse catches are acceptable but need comments. The classifier catches should log warnings since eval accuracy depends on classifier success.

**Files:**
- Modify: `src/eval.js:52,58,151,157`
- Test: `test/eval.test.js` (existing), `test/eval-show.test.js` (existing)

- [ ] **Step 1: Fix empty catches in `runClassifierEval` (lines 52, 58)**

In `src/eval.js`, replace lines 51-58:

```javascript
// BEFORE:
    } catch {}

    let classifierFlags = [];
    try {
      const result = await classifierFn(content);
      classifierFlags = result.flags ?? [];
    } catch {}
```

```javascript
// AFTER:
    } catch { /* raw_response is not JSON — use as-is */ }

    let classifierFlags = [];
    try {
      const result = await classifierFn(content);
      classifierFlags = result.flags ?? [];
    } catch (err) {
      console.warn('[eval] classifier failed for sample:', err.message ?? err);
    }
```

- [ ] **Step 2: Fix empty catches in `getEvalExamples` (lines 151, 157)**

In `src/eval.js`, replace lines 151-157:

```javascript
// BEFORE:
    } catch {}

    let classifierFlags = [];
    try {
      const result = await classifierFn(content);
      classifierFlags = result.flags ?? [];
    } catch {}
```

```javascript
// AFTER:
    } catch { /* raw_response is not JSON — use as-is */ }

    let classifierFlags = [];
    try {
      const result = await classifierFn(content);
      classifierFlags = result.flags ?? [];
    } catch (err) {
      console.warn('[eval] classifier failed for sample:', err.message ?? err);
    }
```

- [ ] **Step 3: Run eval tests**

Run: `node --test test/eval.test.js test/eval-show.test.js`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/eval.js
git commit -m "fix: add logging for classifier failures in eval, document intentional JSON.parse catches"
```

---

### Task 5: Fix error suppression in `src/app.js:93` (getStatus)

There's also an empty `catch {}` in `getStatus()` at line 93 that was flagged.

**Files:**
- Modify: `src/app.js:93`

- [ ] **Step 1: Add comment to intentional catch**

In `src/app.js`, replace line 93:

```javascript
// BEFORE:
    } catch {}
```

```javascript
// AFTER:
    } catch { /* stat may fail if file was just deleted — return 0 */ }
```

- [ ] **Step 2: Run app tests**

Run: `node --test test/app.test.js`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "fix: document intentional error suppression in getStatus"
```

---

### Task 6: Extract shared sample-collection logic in eval.js (eliminates sequential async duplication)

**HARD DEPENDENCY:** Task 4 MUST complete before this task. Both modify `src/eval.js` — Task 4 fixes catch blocks, then this task replaces surrounding loop structure. Reversing the order will invalidate line references.

Both `runClassifierEval` and `getEvalExamples` have identical nested loops to collect reviewed samples. Extract a shared function and use `getRecordsWithFlags` from Task 1 to reduce DB round-trips.

**Files:**
- Modify: `src/eval.js:8-26,116-135`
- Test: `test/eval.test.js` (existing), `test/eval-show.test.js` (existing)

- [ ] **Step 1: Extract `collectLabeledSamples` function**

Add at the top of `src/eval.js`, after the `MIN_SAMPLES_DEFAULT` constant:

```javascript
async function collectLabeledSamples(db) {
  const sessions = await db.listSessions();
  const samples = [];
  for (const session of sessions) {
    const records = await db.getRecordsWithFlags(session.session_id);
    for (const record of records) {
      for (const flag of record.flags) {
        if (flag.review_status === 'unreviewed') continue;
        samples.push({
          flagId: flag.id,
          type: flag.type,
          content: flag.content,
          review_status: flag.review_status,
          raw_response: record.raw_response,
        });
      }
    }
  }
  return samples;
}
```

Note: This still uses sequential await per session because each session's records depend on its session_id. However, it eliminates the inner N+1 query (flags per record) by using `getRecordsWithFlags` which batches that into a single SQL query per session.

Note: `collectLabeledSamples` includes a `content` field that `runClassifierEval` didn't previously collect. This extra field is unused downstream and harmless — it avoids needing two separate collection functions.

- [ ] **Step 2: Replace sample collection in `runClassifierEval`**

Replace lines 9-26 in `runClassifierEval`:

```javascript
// BEFORE (note: original does NOT include flag.content — the shared function adds it as unused):
  const sessions = await db.listSessions();
  const samples = [];

  for (const session of sessions) {
    const records = await db.getSession(session.session_id);
    for (const record of records) {
      const flags = await db.getFlagsForRecord(record.id);
      for (const flag of flags) {
        if (flag.review_status === 'unreviewed') continue;
        samples.push({
          flagId: flag.id,
          type: flag.type,
          review_status: flag.review_status,
          raw_response: record.raw_response,
        });
      }
    }
  }
```

```javascript
// AFTER:
  const samples = await collectLabeledSamples(db);
```

- [ ] **Step 3: Replace sample collection in `getEvalExamples`**

Replace lines 117-135 in `getEvalExamples`:

```javascript
// BEFORE:
  const sessions = await db.listSessions();
  const samples = [];

  for (const session of sessions) {
    const records = await db.getSession(session.session_id);
    for (const record of records) {
      const flags = await db.getFlagsForRecord(record.id);
      for (const flag of flags) {
        if (flag.review_status === 'unreviewed') continue;
        samples.push({
          flagId: flag.id,
          type: flag.type,
          content: flag.content,
          review_status: flag.review_status,
          raw_response: record.raw_response,
        });
      }
    }
  }
```

```javascript
// AFTER:
  const samples = await collectLabeledSamples(db);
```

- [ ] **Step 4: Run eval tests**

Run: `node --test test/eval.test.js test/eval-show.test.js`
Expected: All PASS — behavior is identical, just fewer DB round-trips

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/eval.js
git commit -m "refactor: extract collectLabeledSamples, use batch DB method to reduce N+1 queries"
```

---

### Task 7: Document innerHTML convention (no code change)

The innerHTML usage in `src/ui/server.js` is consistent: all dynamic values pass through `esc()`. This is acceptable for a local dev tool. The fix is to document the convention so AI tools follow it.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add coding convention to CLAUDE.md**

Add the following section to the end of the `### Key design decisions` block in `CLAUDE.md`:

```markdown
- **innerHTML with esc()** — The UI uses `innerHTML` for DOM updates. All dynamic values MUST pass through the `esc()` helper (line 293 of `src/ui/server.js`) which encodes `&`, `<`, `>`, `"`. Never use `innerHTML` with unsanitized data. For new UI code, prefer `textContent` when HTML structure isn't needed.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document innerHTML/esc() convention for UI code"
```

---

### Task 8: Clean up `NEGATIVE_PATTERNS_MITIGATION.md`

The scan artifact is no longer needed since all patterns are addressed.

**Files:**
- Delete: `NEGATIVE_PATTERNS_MITIGATION.md`

- [ ] **Step 1: Remove the mitigation file**

```bash
rm NEGATIVE_PATTERNS_MITIGATION.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove anti-pattern scan artifact"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass, including new `test/storage-batch.test.js`

- [ ] **Step 2: Verify no regressions in API responses**

Spot-check that the session list and session detail endpoints return the same shape by reading the test assertions in `test/ui.test.js`.

- [ ] **Step 3: Verify anti-patterns are resolved**

Quick grep to confirm:
```bash
# Should find 0 empty catches (only commented ones remain)
grep -rn 'catch\s*{}' src/
# Should find 0 .catch(() => {})
grep -rn '\.catch.*=>.*{}' src/
```
