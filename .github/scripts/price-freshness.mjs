import { createRequire } from 'module';

const require = createRequire(import.meta.url);
global.window = {};
require(`${process.cwd()}/data.js`);
const SOLUTIONS = global.window.SOLUTIONS || [];

const ENDPOINT = process.env.GH_MODELS_ENDPOINT || 'https://models.inference.ai.azure.com/chat/completions';
const MODEL    = process.env.GH_MODELS_MODEL    || 'gpt-4o-mini';
const TOKEN    = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('GITHUB_TOKEN missing');
  process.exit(1);
}

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
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28000);
  return { ok: true, status: res.status, text: stripped };
}

async function askModel(sol, pageText) {
  const prompt = `You audit a security tool catalog. Determine whether the cited unit price matches what the page actually displays.

Catalog entry:
- vendor: ${sol.vendor}
- product: ${sol.name}
- cost model: ${sol.cost.model}
- cited unit price: $${sol.cost.unit}
- cited units: ${sol.cost.units}
- cited annual: $${sol.cost.annual}

Source URL: ${sol.cost.sourceUrl}

Page text (HTML stripped):
${pageText}

Return ONLY a single JSON object, no surrounding prose, in this exact shape:
{"pageShowsPrice": boolean, "displayedPrice": "verbatim from page or empty", "displayedUnit": "per-user-month / per-asset-year / flat / empty", "matchesCitation": boolean, "driftDirection": "higher / lower / unknown", "comment": "one short sentence"}

Set matchesCitation=true only if the displayed price is within 20% of the cited unit price for the same model. If the page shows no dollar amount for this product, set pageShowsPrice=false and matchesCitation=false.`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`models endpoint ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const txt = json.choices?.[0]?.message?.content || '';
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in model output');
  return JSON.parse(m[0]);
}

async function audit(sol) {
  const base = { id: sol.id, vendor: sol.vendor, name: sol.name, url: sol.cost.sourceUrl, citedUnit: sol.cost.unit, citedAnnual: sol.cost.annual, model: sol.cost.model };
  try {
    const page = await fetchVisibleText(sol.cost.sourceUrl);
    if (!page.ok)   return { ...base, status: 'fetch-non-200', http: page.status };
    if (!page.text) return { ...base, status: 'empty-page' };
    const finding = await askModel(sol, page.text);
    if (finding.matchesCitation) return { ...base, status: 'match', ...finding };
    if (!finding.pageShowsPrice) return { ...base, status: 'no-price-on-page', ...finding };
    return { ...base, status: 'drift', ...finding };
  } catch (e) {
    return { ...base, status: 'error', error: String(e.message || e) };
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
  await sleep(1500);
}

const report = {
  generated: new Date().toISOString(),
  total: targets.length,
  matches: findings.filter(f => f.status === 'match').length,
  drifts: findings.filter(f => f.status === 'drift'),
  noPrice: findings.filter(f => f.status === 'no-price-on-page'),
  fetchFailures: findings.filter(f => f.status === 'fetch-non-200' || f.status === 'empty-page' || f.status === 'error'),
};

console.log(JSON.stringify(report, null, 2));
