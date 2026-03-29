const MIN_SAMPLES_DEFAULT = 5;

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

// For each labeled flag, re-run the classifier against the raw response
// and check whether it would have produced the same flag type.
// accepted + needs_change = true positives (classifier should find them)
// false_positive = true negatives (classifier should NOT find them)
export async function runClassifierEval({ db, classifierFn, minSamples = MIN_SAMPLES_DEFAULT } = {}) {
  // Collect all reviewed flags with their parent raw response
  const samples = await collectLabeledSamples(db);

  if (!samples.length) {
    return {
      labeled_samples: 0,
      overall: { precision: 0, recall: 0, f1: 0 },
      by_type: [],
      below_threshold: [],
    };
  }

  // Re-run classifier on each sample's raw response
  const results = [];
  for (const sample of samples) {
    let content = sample.raw_response;
    try {
      const parsed = JSON.parse(sample.raw_response);
      // Extract text content if it looks like an API response
      if (parsed.content) {
        content = parsed.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n') || content;
      } else if (typeof parsed === 'string') {
        content = parsed;
      }
    } catch { /* raw_response is not JSON — use as-is */ }

    let classifierFlags = [];
    try {
      const result = await classifierFn(content);
      classifierFlags = result.flags ?? [];
    } catch (err) {
      console.warn('[eval] classifier failed for sample:', err.message ?? err);
    }

    const predicted = classifierFlags.some(f => f.type === sample.type);
    const isPositive = sample.review_status !== 'false_positive';

    results.push({ type: sample.type, predicted, isPositive });
  }

  // Compute per-type and overall metrics
  const typeMap = {};
  for (const r of results) {
    if (!typeMap[r.type]) typeMap[r.type] = { tp: 0, fp: 0, fn: 0, tn: 0, total: 0 };
    const m = typeMap[r.type];
    m.total++;
    if (r.isPositive && r.predicted)  m.tp++;
    if (!r.isPositive && r.predicted) m.fp++;
    if (r.isPositive && !r.predicted) m.fn++;
    if (!r.isPositive && !r.predicted) m.tn++;
  }

  const metrics = (tp, fp, fn) => {
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall    = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1        = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    return {
      precision: Math.round(precision * 100) / 100,
      recall:    Math.round(recall * 100) / 100,
      f1:        Math.round(f1 * 100) / 100,
    };
  };

  const by_type = Object.entries(typeMap).map(([type, m]) => ({
    type,
    samples: m.total,
    ...metrics(m.tp, m.fp, m.fn),
  })).sort((a, b) => b.samples - a.samples);

  const below_threshold = by_type
    .filter(t => t.samples < minSamples)
    .map(t => t.type);

  // Overall metrics (macro average across types)
  const overall = by_type.length
    ? {
        precision: Math.round(by_type.reduce((s, t) => s + t.precision, 0) / by_type.length * 100) / 100,
        recall:    Math.round(by_type.reduce((s, t) => s + t.recall,    0) / by_type.length * 100) / 100,
        f1:        Math.round(by_type.reduce((s, t) => s + t.f1,        0) / by_type.length * 100) / 100,
      }
    : { precision: 0, recall: 0, f1: 0 };

  return {
    labeled_samples: samples.length,
    overall,
    by_type,
    below_threshold,
  };
}

export async function getEvalExamples({ db, classifierFn } = {}) {
  const samples = await collectLabeledSamples(db);

  const missed = [];
  const false_positives = [];
  let true_positive_count = 0;

  for (const sample of samples) {
    let content = sample.raw_response;
    try {
      const parsed = JSON.parse(sample.raw_response);
      if (parsed.content) {
        content = parsed.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n') || content;
      }
    } catch { /* raw_response is not JSON — use as-is */ }

    let classifierFlags = [];
    try {
      const result = await classifierFn(content);
      classifierFlags = result.flags ?? [];
    } catch (err) {
      console.warn('[eval] classifier failed for sample:', err.message ?? err);
    }

    const predicted = classifierFlags.some(f => f.type === sample.type);
    const isPositive = sample.review_status !== 'false_positive';
    const raw_snippet = content.slice(0, 120).replace(/\s+/g, ' ').trim();

    if (isPositive && predicted) {
      true_positive_count++;
    } else if (isPositive && !predicted) {
      // Classifier missed a real flag
      missed.push({
        type: sample.type,
        content: sample.content,
        raw_snippet,
        review_status: sample.review_status,
      });
    } else if (!isPositive && predicted) {
      // Classifier flagged something the reviewer marked false positive
      false_positives.push({
        type: sample.type,
        content: sample.content,
        raw_snippet,
      });
    }
  }

  return {
    total_labeled: samples.length,
    true_positive_count,
    false_negative_count: missed.length,
    false_positive_count: false_positives.length,
    missed,
    false_positives,
  };
}

export function formatEvalExamples(examples) {
  const lines = [];

  lines.push(`Labeled: ${examples.total_labeled}  TP: ${examples.true_positive_count}  Missed: ${examples.false_negative_count}  FP: ${examples.false_positive_count}`);
  lines.push('');

  if (examples.missed.length) {
    lines.push('── Missed flags (classifier should have found these) ────────────────');
    for (const m of examples.missed) {
      lines.push(`  [${m.type}] ${m.content}`);
      lines.push(`  Response: "${m.raw_snippet}${m.raw_snippet.length >= 120 ? '...' : ''}"`);
      lines.push('');
    }
  } else {
    lines.push('── Missed flags ─────────────────────────────────────────────────────');
    lines.push('  None -- classifier found all labeled positives.');
    lines.push('');
  }

  if (examples.false_positives.length) {
    lines.push('── False Positives (classifier flagged, reviewer rejected) ──────────');
    for (const fp of examples.false_positives) {
      lines.push(`  [${fp.type}] ${fp.content}`);
      lines.push(`  Response: "${fp.raw_snippet}${fp.raw_snippet.length >= 120 ? '...' : ''}"`);
      lines.push('');
    }
  } else {
    lines.push('── False Positives ───────────────────────────────────────────────────');
    lines.push('  None -- no false positives in labeled set.');
    lines.push('');
  }

  return lines.join('\n');
}


export function formatEvalReport(report, date = new Date()) {
  const lines = [];
  lines.push(`Labeled samples: ${report.labeled_samples}`);
  lines.push('');

  if (!report.labeled_samples) {
    lines.push('No labeled samples found. Review session flags to build a ground truth set.');
    return lines.join('\n');
  }

  lines.push(`Overall:    precision ${report.overall.precision.toFixed(2)}  recall ${report.overall.recall.toFixed(2)}  F1 ${report.overall.f1.toFixed(2)}`);
  lines.push('By type:');

  for (const t of report.by_type) {
    const threshold = report.below_threshold.includes(t.type) ? ' (below min samples)' : '';
    lines.push(`  ${t.type.padEnd(14)} P ${t.precision.toFixed(2)}  R ${t.recall.toFixed(2)}  F1 ${t.f1.toFixed(2)}  (${t.samples} samples)${threshold}`);
  }

  if (report.below_threshold.length) {
    lines.push('');
    lines.push(`Types below minimum sample threshold: ${report.below_threshold.join(', ')}`);
  }

  return lines.join('\n');
}
