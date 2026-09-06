const TOLERANCE = 0.20; // 20% — matches the prior LLM audit contract
const BOT_BLOCK = new Set([401, 403, 429]);
// Common marketing / promo amounts that poison matching on Azure/Microsoft pages.
const IGNORE_VALUES = new Set([200]); // e.g. "$200 Azure credit"

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

function explicitPackSize(textAfterPrice) {
  // Require the quantity to describe this price, not an inferred price ratio or
  // an unrelated seat count elsewhere on the page.
  const match = textAfterPrice.match(/^\s*(?:(?:(?:\/|per\s+)(?:year|yr|month|mo)\b|annually\b|yearly\b|monthly\b)\s*)?(?:for\b|per\b|\/)\s*(?:(?:a\s+)?(?:pack|block)\s+of\s+)?(\d+)\s+(?:(?:contributing|active)\s+)?(?:seats?|users?|developers?|contributors?|committers?|devices?|endpoints?)\b/i);
  const quantity = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(quantity) && quantity > 1 ? quantity : null;
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
      packSize: explicitPackSize(text.slice(m.index + m[0].length, m.index + m[0].length + 120)),
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
  // Only normalize a pack when the page explicitly associates a seat count
  // with this price. A multiple of the cited price is not evidence of a pack.
  if (c.packSize) {
    targets.push({ comparedAs: c.annualized / c.packSize, label: `pack-of-${c.packSize}`, against: citedUnit });
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

export function classify(sol, page) {
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
