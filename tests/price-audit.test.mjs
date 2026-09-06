import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from '../.github/scripts/price-audit.mjs';

function audit(text, unit = 100) {
  return classify({
    id: 'fixture', vendor: 'Fixture', name: 'Pro',
    cost: { unit, annual: unit, model: 'per-user', sourceUrl: 'https://example.com/pricing' },
  }, { ok: true, text });
}

test('a price increase is not treated as an inferred seat pack', () => {
  for (const text of [
    'Pro plan $300 per user per year',
    'Pro plan $300 per user per year. Minimum 3 users.',
    'Pro plan $300. Team size: 3 seats.',
  ]) {
    const result = audit(text);
    assert.equal(result.status, 'drift', text);
    assert.equal(result.driftDirection, 'higher', text);
    assert.doesNotMatch(result.displayedUnit, /pack/);
  }
});

test('explicit annual pack pricing is normalized by the stated seat quantity', () => {
  for (const text of [
    '$5,500/yr per 25 contributing developers',
    '$5,500 per year for 25 seats',
    '$5,500 for a pack of 25 users per year',
  ]) {
    const result = audit(text, 220);
    assert.equal(result.status, 'match', text);
    assert.equal(result.displayedUnit, 'pack-of-25', text);
  }
});

test('explicit monthly packs are annualized before division', () => {
  const result = audit('$500 per month for 25 seats', 240);
  assert.equal(result.status, 'match');
  assert.equal(result.displayedUnit, 'pack-of-25');
});

test('stated pack quantity is used even when price has drifted', () => {
  const result = audit('$7,500 per year for 25 seats', 220);
  assert.equal(result.status, 'drift');
  assert.equal(result.driftDirection, 'higher');
  assert.equal(result.displayedUnit, 'pack-of-25');
});

test('ordinary matching and missing price classification are preserved', () => {
  assert.equal(audit('$100 per user per year').status, 'match');
  assert.equal(audit('$10 per user per month', 120).status, 'match');
  assert.equal(audit('Contact sales for pricing.').status, 'no-price-on-page');
});

test('bot blocks and transport statuses remain distinct from price drift', () => {
  const sol = { id: 'fixture', cost: { unit: 100, annual: 100 } };
  assert.equal(classify(sol, { ok: false, status: 403 }).status, 'bot-blocked');
  assert.equal(classify(sol, { ok: false, status: 404 }).status, 'fetch-non-200');
  assert.equal(classify(sol, { ok: true, text: '' }).status, 'empty-page');
});
