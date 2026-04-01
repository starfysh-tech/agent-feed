# Fix: Proxy Request Body Corruption via String Concatenation

**Date:** 2026-04-01
**Status:** Validated
**Symptom:** Frequent 400 errors from Anthropic API: "unexpected end of data: line 1 column 1549310"
**Root cause:** Request body accumulated as string (Buffer→string coercion at chunk boundaries corrupts multi-byte UTF-8), then forwarded with original content-length header → byte count mismatch → truncated JSON.

## The Bug (src/proxy/index.js:81-83, 262)

```js
let requestBody = '';
req.on('data', chunk => { requestBody += chunk; });  // implicit Buffer.toString('utf-8') per chunk
// ...
if (requestBody) upstreamReq.write(requestBody);     // re-encodes string to UTF-8, different byte count
```

**Why it corrupts:**
1. TCP chunk boundaries can split multi-byte UTF-8 sequences (emoji, CJK, encoded chars)
2. Each chunk's implicit `.toString('utf-8')` produces U+FFFD replacement chars for orphaned bytes
3. U+FFFD encodes to 3 bytes in UTF-8, expanding the body beyond original content-length
4. Original `content-length` header is forwarded unchanged (line 118-128)
5. Upstream reads exactly `content-length` bytes → truncated JSON → 400

## Proposed Changes

### 1. Accumulate request body as Buffer (proxy/index.js:81-85)

**Before:**
```js
let requestBody = '';
req.on('data', chunk => { requestBody += chunk; });
req.on('end', () => {
  this._forwardRequest(req, requestBody, res);
});
```

**After:**
```js
const requestChunks = [];
req.on('data', chunk => { requestChunks.push(chunk); });
req.on('end', () => {
  const requestBody = Buffer.concat(requestChunks);
  this._forwardRequest(req, requestBody, res);
});
```

### 2. Forward raw buffer, scrub only the capture copy (proxy/index.js:88-133, 262)

- `_forwardRequest` receives a Buffer, writes it directly to upstream (preserving exact bytes)
- Do NOT modify `content-length` — raw buffer bytes match the original, so the header is already correct
- Line 133: convert to string at the call site: `this._scrubBodyKeys(requestBody.toString())`
- `_scrubBodyKeys` contract unchanged (string in, string out)
- The forwarded body is NEVER converted to string

### 3. Fix empty-body guard (proxy/index.js:262)

**Before:** `if (requestBody) upstreamReq.write(requestBody);`
**After:** `if (requestBody.length) upstreamReq.write(requestBody);`

Empty Buffer is truthy (unlike empty string). Without this fix, GET requests would send a zero-length body chunk to upstream.

## Files Changed

| File | Change |
|------|--------|
| `src/proxy/index.js` | Buffer accumulation, forward raw bytes, scrub only capture copy |
| `test/proxy.test.js` | Add test: large body with multi-byte chars preserved through proxy |

## Assumptions

1. All request bodies are UTF-8 encoded JSON (true for Anthropic/OpenAI/Google APIs)
2. No request body transformations are needed beyond scrubbing for capture
3. The `content-length` header from the client accurately reflects the original body size

## Risks

- Existing tests that check `rawRequest` in captures may need adjustment if scrubbing behavior changes
- Need to verify `upstreamReq.write(buffer)` sends raw bytes without re-encoding

---

# Validation Results

**Validated:** 2026-04-01
**Verdict:** REASONABLE

**Empirically confirmed:** String concatenation of split Buffer chunks produces U+FFFD replacement chars that expand byte count (4-byte emoji → 9-byte corruption), causing content-length mismatch.

## Issues Found

### Critical (Must Address)

- **Empty Buffer truthy guard**: `if (requestBody)` at line 262 — `Buffer.alloc(0)` is truthy, would send zero-length body chunk on GET requests
  - _Impact_: Some upstreams may reject GET-with-body; semantic behavior change
  - _Mitigation_: Change to `if (requestBody.length)`
  - _File_: `src/proxy/index.js:262`

- **`_scrubBodyKeys` return type**: If Buffer passed directly, the catch branch returns raw Buffer. `pipeline.js:_hashRequest` (line 94) calls `.charCodeAt(i)` → TypeError → capture silently lost
  - _Impact_: All captures for non-JSON bodies would fail silently
  - _Mitigation_: Convert to string at call site (line 133: `requestBody.toString()`), not inside `_scrubBodyKeys`
  - _File_: `src/proxy/index.js:133`, `src/pipeline.js:94`

### High Risk (Should Address)

- **No regression test for multi-byte bodies**: All existing tests use ASCII JSON. A test that sends deliberately split multi-byte chunks is essential to verify the fix.
  - _Impact_: Fix could regress without detection
  - _Recommendation_: Add test with emoji/CJK body split across chunks

### Simplification Opportunities

- **No content-length manipulation needed** → Raw buffer bytes match original content-length by construction. Plan originally said "update content-length" — removed, simpler.
- **`_scrubBodyKeys` stays unchanged** → Converting at call site (line 133) is simpler than modifying the function signature.

## Cross-Model Review (Codex)

*Model: gpt-5.4 | Sandbox: read-only | Status: completed*

### Findings

- **Empty Buffer guard**: Independently confirmed `Buffer.alloc(0)` is truthy — must check `.length`
  - _Severity_: High
  - _File_: `src/proxy/index.js:262`

- **`setEncoding('utf8')` is insufficient**: Fixes accumulation but still re-encodes on write, leaving content-length mismatch risk
  - _Severity_: Medium (alternative approach risk)

- **Bug is real but unverified from code alone**: Codex notes no logging/metrics confirm this is the active cause — relies on user's observation that errors don't occur without agent-feed
  - _Severity_: Medium (observational evidence is strong but not instrumented)

### Agreement with Claude Analysis
- All 4 Claude subagents and Codex independently converged on the same two mandatory fixes (guard + scrub call site)
- All agree Buffer approach is correct over `setEncoding` or `pipe` alternatives

### Novel Findings
- Codex suggested removing `_scrubBodyKeys` entirely as a simplification (API keys in request bodies are rare; headers are already scrubbed). Not recommended but worth noting as a future option.
- Codex flagged that for small payloads, Node typically sends in a single chunk — the bug manifests primarily with large bodies (which matches the ~1.5MB error)

## Plan Revisions Made

- Changed "Update content-length header" to "Do NOT modify content-length" — raw bytes already match
- Changed "_scrubBodyKeys accepts Buffer or string" to "convert at call site, keep function contract unchanged"
- Added empty-Buffer guard as explicit change item (was missing from original plan)
- Removed "Update _scrubBodyKeys signature" section — no longer needed

## Decisions Confirmed

- [x] **Buffer accumulation over `setEncoding`**: Eliminates encoding round-trip entirely, mirrors existing response-side pattern
- [x] **Convert at call site, not in `_scrubBodyKeys`**: Simpler, preserves function contract, avoids downstream type surprises
- [x] **No `req.pipe()` restructuring**: Would require PassThrough stream and method restructuring for marginal benefit

## Dependencies Affected

| Component | Impact | Action Needed |
|-----------|--------|---------------|
| `src/proxy/index.js:81-85` | Accumulation changes | Buffer[] + concat |
| `src/proxy/index.js:133` | Scrub call | Add `.toString()` |
| `src/proxy/index.js:262` | Write guard | Check `.length` |
| `src/pipeline.js:94` | `_hashRequest` | No change (receives string from scrub) |
| `src/storage/database.js` | `raw_request` column | No change (receives string) |

## Follow-up: Log non-2xx upstream status codes

The proxy currently pipes upstream responses silently — no logging of `statusCode`. A 400 from the API (caused by this bug) is invisible in `agent-feed.log`. Add a warning log after `res.writeHead` at line 170:

```js
if (upstreamRes.statusCode >= 400) {
  console.warn(`[proxy] upstream ${upstreamRes.statusCode} ${req.method} ${forwardPath}`);
}
```

This is a separate concern from the Buffer fix but should ship with it for observability.

## Test Implications

- Tests expected to fail: none (all use ASCII JSON bodies)
- Tests needing updates: none
- New coverage needed: multi-byte body split across chunks, GET with no body
