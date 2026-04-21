# Evals

Agent Feed has two kinds of evals: **classifier quality** (is the LLM correctly extracting flags?) and **agent/prompt quality** (are your prompts producing better decisions over time?). The first is measured with CLI commands. The second is visible in the Trends view.

## Building a ground truth set

The ground truth set is built passively as you review sessions. Every flag you mark `accepted`, `needs_change`, or `false_positive` in the UI becomes a labeled sample. No separate labeling step needed.

1. Run a few agent sessions covering different task types
2. Open the UI and mark each flag: `accepted` or `needs_change` for real flags, `false_positive` for noise
3. Aim for 10+ samples per flag type before acting on the numbers (minimum 5 for per-type metrics)

## Measuring classifier quality

```bash
agent-feed eval classifier
```

```
Classifier Eval -- 2026-03-28
Labeled samples: 87

Overall:    precision 0.81  recall 0.74  F1 0.77
By type:
  decision       P 0.89  R 0.82  F1 0.85  (24 samples)
  assumption     P 0.76  R 0.71  F1 0.73  (18 samples)
  ...
```

- **Precision** — of extracted flags, how many were real? Low = too much noise.
- **Recall** — of real flags, how many were found? Low = missing decisions.
- **F1** — headline number for comparing prompt iterations.

For a review tool, recall matters more than precision.

## Finding what to fix

```bash
agent-feed eval show
```

Shows specific missed flags and false positives. Use this to diagnose the classifier prompt.

## Improving the classifier prompt

The prompt lives in `src/classifier/index.js` as `CLASSIFICATION_PROMPT`. Edit it based on `eval show` output.

| Problem | Fix |
|---|---|
| Missing `assumption` flags | Add examples of passive phrasing ("assuming X is available") |
| False positives on file listings | Add negative examples |
| Missing `workaround` flags | Add temporal language examples ("for now", "temporarily") |
| Low recall on `risk` | Add examples of hedging language |

Re-run `eval classifier` after each edit and compare F1 scores.

## Tracking agent/prompt quality

The Trends view shows flag patterns across sessions. What to look for:

- **Rising workaround rate** — prompt lacks context for correct solutions
- **High assumption rate** — agent needs more information in the system prompt
- **Decisions clustering** — agent has a default; decide if it's correct or redirect
- **False positive rate rising** — classifier prompt has drifted; re-calibrate

## The improvement loop

```
Run session → Review flags → eval classifier → eval show → Edit prompt → eval classifier (confirm F1 improved) → repeat
```

Run periodically, not after every session. 10+ newly reviewed flags between runs gives meaningful signal.
