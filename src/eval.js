const MIN_SAMPLES_DEFAULT = 5;

// For each labeled flag, re-run the classifier against the raw response
// and check whether it would have produced the same flag type.
// accepted + needs_change = true positives (classifier should find them)
// false_positive = true negatives (classifier should NOT find them)
export async function runClassifierEval({ db, classifierFn, minSamples = MIN_SAMPLES_DEFAULT } = {}) {
  // Collect all reviewed flags with their parent raw response
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
    } catch {}

    let classifierFlags = [];
    try {
      const result = await classifierFn(content);
      classifierFlags = result.flags ?? [];
    } catch {}

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

export function formatEvalReport(report, date = new Date()) {
  const lines = [];
  lines.push(`Classifier Eval -- ${date.toISOString().slice(0, 10)}`);
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
