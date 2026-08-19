import { createRequire } from 'module';

const require = createRequire(import.meta.url);
global.window = {};
require(`${process.cwd()}/data.js`);
const SOLUTIONS = global.window.SOLUTIONS || [];

// GitHub Models was retired 2026-07-30. This auditor is deterministic: fetch the
// cited page, extract dollar amounts, annualize monthly figures, and compare to
// the catalog unit price within a tolerance. No LLM / models API required.

const UA = {
  'User-Agent': 'Mozilla/5.0 (compatible; security-stack-modeler-price-audit/1.0)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const TOLERANCE = 0.20; // 20% — matches the prior LLM audit contract
const BOT_BLOCK = new Set([401, 403, 429]);
// Common marketing / promo amounts that poison matching on Azure/Microsoft pages.
const IGNORE_VALUES = new Set([200]); // e.g. "$200 Azure credit"

async function fetchVisibleText(url) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) return { ok: false, status: res.status, text: '' };
  const html = await res.text();
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40000);
  return { ok: true, status: res.status, text: stripped };
}

function isMonthlyContext(ctx) {
  // "billed annually" means the *monthly* list rate is prepaid yearly — still monthly.
  const hasPerMonth = /\bper\s*month\b|\b\/\s*month\b|\b\/mo\b|\buser\/month\b|\b\/user\/mo\b/.test(ctx);
  const hasMonthWord = /\bmonth\b|\b\/mo\b/.test(ctx);
  const hasPerSeat = /\bper\s+(?:user|developer|contributor|committer|device|endpoint|macOS device|mobile device)\b/.test(ctx);
  const hasExplicitAnnualUnit = /\bper\s*year\b|\b\/yr\b|\b\/year\b|\bper\s+(?:user|developer|device|endpoint)\s*\/\s*year\b/.test(ctx);
  if (hasExplicitAnnualUnit && !hasPerMonth) return false;
  if (hasPerMonth) return true;
  if (hasMonthWord && hasPerSeat) return true;
  return false;
}

/** Parse "$1,234.56" / "$1.258" style amounts from surrounding context. */
function extractPriceCandidates(text) {
  const candidates = [];
  const re = /\$\s*([\d,]+(?:\.\d+)?)\s*(k\b)?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    let value = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) continue;
    if (m[2]) value *= 1000;
    if (IGNORE_VALUES.has(value)) continue;

    const start = Math.max(0, m.index - 56);
    const end = Math.min(text.length, m.index + m[0].length + 72);
    const ctx = text.slice(start, end).toLowerCase();
    // Skip Azure / marketing credit blurbs.
    if (/\bcredit\b/.test(ctx) && value === 200) continue;

    const monthly = isMonthlyContext(ctx);
    const annualized = monthly ? value * 12 : value;

    candidates.push({
      raw: m[0].replace(/\s+/g, ''),
      value,
      annualized,
      monthly,
      ctx: ctx.replace(/\s+/g, ' ').trim().slice(0, 120),
    });
  }
  return candidates;
}

function withinTol(a, b) {
  return Math.abs(a - b) / Math.max(b, 0.0001) <= TOLERANCE;
}

/**
 * Score a page amount against the catalog citation.
 * Considers: raw value, annualized monthly, cited annual, and pack multiples
 * (e.g. AWS Marketplace $5,500 / 25 seats = $220/seat).
 */
function scoreCandidate(citedUnit, citedAnnual, c) {
  const targets = [
    { comparedAs: c.annualized, label: c.monthly ? 'annualized-from-monthly' : 'as-shown' },
    { comparedAs: c.value, label: 'as-shown' },
  ];
  if (citedAnnual && citedAnnual !== citedUnit) {
    targets.push({ comparedAs: c.value, label: 'vs-cited-annual', against: citedAnnual });
    targets.push({ comparedAs: c.annualized, label: 'vs-cited-annual', against: citedAnnual });
  }
  // Pack pricing: page shows a block total (25 seats, etc.)
  if (citedUnit > 0) {
    const ratio = c.value / citedUnit;
    if (ratio >= 2 && ratio <= 200 && Math.abs(ratio - Math.round(ratio)) < 0.05) {
      targets.push({ comparedAs: c.value / Math.round(ratio), label: `pack-of-${Math.round(ratio)}`, against: citedUnit });
    }
  }

  let best = null;
  for (const t of targets) {
    const against = t.against != null ? t.against : citedUnit;
    const delta = Math.abs(t.comparedAs - against) / Math.max(against, 0.0001);
    if (!best || delta < best.delta) {
      best = { ...c, comparedAs: t.comparedAs, displayedUnit: t.label, delta, against };
    }
  }
  return best;
}

function bestMatch(citedUnit, citedAnnual, candidates) {
  if (!candidates.length) return null;
  let best = null;
  for (const c of candidates) {
    const scored = scoreCandidate(citedUnit, citedAnnual, c);
    // Prefer any in-tolerance match over a closer absolute miss.
    if (!best) { best = scored; continue; }
    const bestIn = best.delta <= TOLERANCE;
    const scoredIn = scored.delta <= TOLERANCE;
    if (scoredIn && !bestIn) best = scored;
    else if (scoredIn === bestIn && scored.delta < best.delta) best = scored;
  }
  return best;
}

function classify(sol, page) {
  const base = {
    id: sol.id,
    vendor: sol.vendor,
    name: sol.name,
    url: sol.cost.sourceUrl,
    citedUnit: sol.cost.unit,
    citedAnnual: sol.cost.annual,
    model: sol.cost.model,
  };

  if (!page.ok) {
    if (BOT_BLOCK.has(page.status)) {
      return { ...base, status: 'bot-blocked', http: page.status };
    }
    return { ...base, status: 'fetch-non-200', http: page.status };
  }
  if (!page.text) return { ...base, status: 'empty-page' };

  const candidates = extractPriceCandidates(page.text);
  if (!candidates.length) {
    return {
      ...base,
      status: 'no-price-on-page',
      pageShowsPrice: false,
      displayedPrice: '',
      matchesCitation: false,
      comment: 'No dollar amounts found in stripped page text.',
    };
  }

  const match = bestMatch(sol.cost.unit, sol.cost.annual, candidates);
  if (match && match.delta <= TOLERANCE) {
    return {
      ...base,
      status: 'match',
      pageShowsPrice: true,
      displayedPrice: match.raw,
      displayedUnit: match.displayedUnit,
      matchesCitation: true,
      driftDirection: 'none',
      comment: `Closest page amount ${match.raw} (compared as $${Number(match.comparedAs.toFixed(2))}) within ${Math.round(match.delta * 100)}% of cited.`,
    };
  }

  const driftDirection = match.comparedAs > match.against ? 'higher' : 'lower';
  return {
    ...base,
    status: 'drift',
    pageShowsPrice: true,
    displayedPrice: match.raw,
    displayedUnit: match.displayedUnit,
    matchesCitation: false,
    driftDirection,
    comment: `Closest page amount ${match.raw} (compared as $${Number(match.comparedAs.toFixed(2))}) is ${Math.round(match.delta * 100)}% ${driftDirection} than cited $${match.against}.`,
  };
}

async function audit(sol) {
  try {
    const page = await fetchVisibleText(sol.cost.sourceUrl);
    return classify(sol, page);
  } catch (e) {
    return {
      id: sol.id,
      vendor: sol.vendor,
      name: sol.name,
      url: sol.cost.sourceUrl,
      citedUnit: sol.cost.unit,
      citedAnnual: sol.cost.annual,
      model: sol.cost.model,
      status: 'error',
      error: String(e.message || e),
    };
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const targets = SOLUTIONS.filter(
  s => s.id !== 'none' && s.cost && s.cost.source !== 'free' && s.cost.sourceUrl && s.cost.sourceUrl.startsWith('http')
);

const findings = [];
for (const sol of targets) {
  const f = await audit(sol);
  findings.push(f);
  await sleep(800);
}

const report = {
  generated: new Date().toISOString(),
  total: targets.length,
  matches: findings.filter(f => f.status === 'match').length,
  drifts: findings.filter(f => f.status === 'drift'),
  noPrice: findings.filter(f => f.status === 'no-price-on-page'),
  botBlocked: findings.filter(f => f.status === 'bot-blocked'),
  fetchFailures: findings.filter(f => f.status === 'fetch-non-200' || f.status === 'empty-page' || f.status === 'error'),
};

console.log(JSON.stringify(report, null, 2));
