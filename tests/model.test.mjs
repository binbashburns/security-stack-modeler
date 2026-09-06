import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

function model() {
  const ctx = createContext({ window: {}, document: { addEventListener() {} } });
  for (const file of ['data.js', 'app.js']) {
    runInContext(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), ctx);
  }
  runInContext('loadEmptyBoard()', ctx);
  return code => runInContext(code, ctx);
}

test('blank and bundled plans preserve zero cost and deduplicated pricing', () => {
  const run = model();
  assert.equal(run('totalAnnualCost()'), 0);
  assert.equal(run('coverageStats().covered'), 0);
  run("loadScenario('gitlab-native')");
  assert.equal(run('coverageStats().covered'), 11);
  assert.equal(run('selectedSolutions().length'), 1);
  assert.equal(run('totalAnnualCost()'), 17820);
  run('state.orgSizing.developers = 30');
  assert.equal(run('totalAnnualCost()'), 35640);
});

test('invalid price overrides fall back to catalog pricing', () => {
  const run = model();
  run("loadScenario('gitlab-native')");
  for (const value of ['-10', 'NaN', 'Infinity', '-Infinity', '1e300', "''"]) {
    run(`state.costOverrides['gitlab-ultimate'] = { unit: ${value} }`);
    assert.equal(run('totalAnnualCost()'), 17820, value);
  }
  run("state.costOverrides['gitlab-ultimate'] = { unit: 123.45 }");
  assert.equal(run('totalAnnualCost()'), 1851.75);
  run("state.costOverrides['gitlab-ultimate'] = { unit: 0 }");
  assert.equal(run('totalAnnualCost()'), 0);
});

test('fixed quantities and org sizing reject invalid values but allow zero', () => {
  const run = model();
  run("applySelection('pentest', 'third-party-pentest')");
  const baseline = run('totalAnnualCost()');
  assert(baseline > 0);
  for (const value of ['-2', 'NaN', 'Infinity', '1e300']) {
    run(`state.costOverrides['third-party-pentest'] = { units: ${value} }`);
    assert.equal(run('totalAnnualCost()'), baseline, value);
  }
  run("state.costOverrides['third-party-pentest'] = { unit: 500, units: 2 }");
  assert.equal(run('totalAnnualCost()'), 1000);
  run("state.costOverrides['third-party-pentest'].units = 0");
  assert.equal(run('totalAnnualCost()'), 0);
  run("loadScenario('gitlab-native')");
  for (const value of ['-2', 'NaN', 'Infinity', '1e300']) {
    run(`state.orgSizing.developers = ${value}`);
    assert.equal(run('totalAnnualCost()'), 17820, value);
  }
  run('state.orgSizing.developers = 0');
  assert.equal(run('totalAnnualCost()'), 0);
});

test('external coverage adds no cost and no scanner steps', () => {
  const run = model();
  run("applySelection('sast', 'covered-external')");
  assert.equal(run('coverageStats().covered'), 1);
  assert.equal(run('totalAnnualCost()'), 0);
  assert.doesNotMatch(run('buildCiWorkflowYaml()'), /^jobs:/m);
});

test('multi-capability CI templates emit once with the strongest enforcement', () => {
  const run = model();
  run("applySelection('container-scan', 'trivy')");
  for (const hardCap of ['container-scan', 'iac-scan']) {
    run("state.enforcement['container-scan'] = 'visibility'; state.enforcement['iac-scan'] = 'soft'");
    run(`state.enforcement['${hardCap}'] = 'hard'`);
    const yaml = run('buildCiWorkflowYaml()');
    assert.equal((yaml.match(/- name: Trivy filesystem scan/g) || []).length, 1);
    assert.equal((yaml.match(/#   - \[build\] Aqua Trivy/g) || []).length, 1);
    assert.doesNotMatch(yaml, /^\s+continue-on-error:/m);
  }
  run("state.enforcement['container-scan'] = 'visibility'; state.enforcement['iac-scan'] = 'soft'");
  assert.equal((run('buildCiWorkflowYaml()').match(/^\s+continue-on-error: true/gm) || []).length, 1);
  run("state.enforcement['iac-scan'] = 'hard'; applySelection('iac-scan', 'none')");
  assert.match(run('buildCiWorkflowYaml()'), /^\s+continue-on-error: true/m);
});

test('different solutions remain separate and CI generation does not mutate templates', () => {
  const run = model();
  run("applySelection('sast', 'semgrep-oss'); applySelection('container-scan', 'trivy')");
  const before = run('JSON.stringify(window.SOLUTIONS)');
  const yaml = run('buildCiWorkflowYaml()');
  assert.equal((yaml.match(/- name: Semgrep/g) || []).length, 1);
  assert.equal((yaml.match(/- name: Trivy filesystem scan/g) || []).length, 1);
  assert.equal(run('JSON.stringify(window.SOLUTIONS)'), before);
});
