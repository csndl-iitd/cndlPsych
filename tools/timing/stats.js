// Distribution summaries for latency reports.

/** Linear-interpolated percentile (p in 0-100) of a list of numbers. */
export function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (p / 100) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** @returns {{n: number, min: number, median: number, p95: number, p99: number, max: number}} */
export function summarize(values) {
  const clean = values.filter(Number.isFinite);
  return {
    n: clean.length,
    min: Math.min(...clean),
    median: percentile(clean, 50),
    p95: percentile(clean, 95),
    p99: percentile(clean, 99),
    max: Math.max(...clean),
  };
}

const fixed = (value) => (Number.isFinite(value) ? value.toFixed(2) : 'n/a');

/** A markdown table row set for named summaries, in milliseconds. */
export function summaryTable(rows) {
  const lines = ['| Measure | n | min | median | p95 | p99 | max |', '|---|---|---|---|---|---|---|'];
  for (const [name, summary] of rows) lines.push(`| ${name} | ${summary.n} | ${fixed(summary.min)} | ${fixed(summary.median)} | ${fixed(summary.p95)} | ${fixed(summary.p99)} | ${fixed(summary.max)} |`);
  return lines.join('\n');
}
