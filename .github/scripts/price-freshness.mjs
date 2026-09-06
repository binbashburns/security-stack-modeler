import { classify } from './price-audit.mjs';
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
