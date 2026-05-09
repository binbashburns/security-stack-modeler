const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const SOLUTIONS_BY_ID    = Object.fromEntries(window.SOLUTIONS.map(s => [s.id, s]));
const CAPABILITIES_BY_ID = Object.fromEntries(window.CAPABILITIES.map(c => [c.id, c]));
const STAGES_BY_ID       = Object.fromEntries(window.DSO_STAGES.map(s => [s.id, s]));
const PHASES_BY_ID       = Object.fromEntries(window.ENFORCEMENT_PHASES.map(p => [p.id, p]));

const FRAMEWORKS = ['SOC 2', 'NIST CSF 2.0', 'NIST SSDF'];
const COST_DIMS  = window.MODEL_META.costModelDimensions;

const SIZING_LABELS = {
  developers:     'Developers',
  endpoints:      'Endpoints',
  users:          'Workforce users',
  cloudInstances: 'Cloud instances',
  containers:     'Container images',
};

const SIZING_HINTS = {
  developers:     'Engineers writing code',
  endpoints:      'Workstations + servers',
  users:          'Total workforce identities',
  cloudInstances: 'EC2 / VM / Compute Engine',
  containers:     'Container images managed',
};

const fmt$ = n => n == null ? '$0' : '$' + Math.round(n).toLocaleString();

const isUnselected = sol => !sol || sol.id === 'none' || sol.gap;
const sizingDimFor = sol => sol && sol.cost ? (COST_DIMS[sol.cost.model] || null) : null;
const isSizedModel = sol => sizingDimFor(sol) != null;

const state = {
  view: 'scenario',
  scenarioId: null, // null = blank slate, no preset loaded
  selections: {},
  enforcement: {},
  orgSizing: { ...window.MODEL_META.defaultSizing },
  costOverrides: {},
  frameworkFilter: 'all',
  modal: null,
};

function loadEmptyBoard() {
  state.scenarioId = null;
  state.selections = { ...window.DEFAULT_SELECTIONS };
  state.enforcement = { ...window.DEFAULT_ENFORCEMENT };
  for (const cap of window.CAPABILITIES) {
    if (!(cap.id in state.selections))  state.selections[cap.id]  = 'none';
    if (!(cap.id in state.enforcement)) state.enforcement[cap.id] = 'none';
  }
}

function loadScenario(scenarioId) {
  const scenario = window.SCENARIOS.find(s => s.id === scenarioId);
  if (!scenario) { loadEmptyBoard(); return; }
  state.scenarioId = scenarioId;
  state.selections  = { ...window.DEFAULT_SELECTIONS, ...scenario.selections };
  state.enforcement = { ...window.DEFAULT_ENFORCEMENT, ...(scenario.enforcement || {}) };
  for (const cap of window.CAPABILITIES) {
    if (!(cap.id in state.selections))  state.selections[cap.id]  = 'none';
    if (!(cap.id in state.enforcement)) state.enforcement[cap.id] = 'none';
  }
}

function effectiveCost(solution) {
  const ov = state.costOverrides[solution.id] || {};
  const unit = ov.unit != null ? Number(ov.unit) : solution.cost.unit;
  const dim = sizingDimFor(solution);
  let units;
  if (dim) {
    units = Number(state.orgSizing[dim] ?? 0);
  } else {
    units = ov.units != null ? Number(ov.units) : solution.cost.units;
  }
  const annual = unit * units;
  return { unit, units, annual, dim };
}

function selectedSolutions() {
  const ids = new Set(Object.values(state.selections));
  ids.delete('none');
  return [...ids].map(id => SOLUTIONS_BY_ID[id]).filter(Boolean);
}

function totalAnnualCost() {
  return selectedSolutions().reduce((sum, s) => sum + effectiveCost(s).annual, 0);
}

function coverageStats() {
  const total = window.CAPABILITIES.length;
  const covered = window.CAPABILITIES.filter(c => {
    const solId = state.selections[c.id];
    return solId && solId !== 'none';
  }).length;
  return { covered, total, gaps: total - covered };
}

function renderSolutionMeta(sol, opts = {}) {
  const { linkClass = '', stopPropagation = false } = opts;
  const frag = document.createDocumentFragment();
  if (sol.cost.sourceUrl) {
    const line = el('div', linkClass || 'modal-option-source');
    line.innerHTML = `<span class="modal-option-meta-label">Source</span> `;
    if (sol.cost.sourceUrl.startsWith('http')) {
      const a = document.createElement('a');
      a.href = sol.cost.sourceUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = shortUrl(sol.cost.sourceUrl);
      if (stopPropagation) a.addEventListener('click', e => e.stopPropagation());
      line.appendChild(a);
    } else {
      line.appendChild(document.createTextNode(sol.cost.sourceUrl));
    }
    frag.appendChild(line);
  }
  for (const extra of (sol.extraSources || [])) {
    if (!extra || !extra.url) continue;
    const line = el('div', linkClass || 'modal-option-source');
    line.innerHTML = `<span class="modal-option-meta-label">${escapeText(extra.label || 'Also')}</span> `;
    if (extra.url.startsWith('http')) {
      const a = document.createElement('a');
      a.href = extra.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = shortUrl(extra.url);
      if (stopPropagation) a.addEventListener('click', e => e.stopPropagation());
      line.appendChild(a);
    } else {
      line.appendChild(document.createTextNode(extra.url));
    }
    frag.appendChild(line);
  }
  if (sol.cost.contact && sol.cost.source !== 'free') {
    const c = el('div', linkClass ? linkClass.replace('source', 'contact') : 'modal-option-contact');
    c.innerHTML = `<span class="modal-option-meta-label">Quote from</span> ${escapeText(sol.cost.contact)}`;
    frag.appendChild(c);
  }
  return frag;
}

function controlCoverage(control) {
  if (!control.capabilities || control.capabilities.length === 0) return 'na';
  let covered = 0;
  for (const capId of control.capabilities) {
    const sel = state.selections[capId];
    if (sel && sel !== 'none') covered++;
  }
  if (covered === 0) return 'gap';
  if (covered === control.capabilities.length) return 'covered';
  return 'partial';
}

function render() {
  $$('.zone-card').forEach(c => {
    const active = c.dataset.mode === state.view;
    c.classList.toggle('active', active);
    c.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const main = $('#main');
  main.innerHTML = '';
  switch (state.view) {
    case 'scenario': main.appendChild(renderScenarioView()); break;
    case 'coverage': main.appendChild(renderCoverageView()); break;
    case 'pipeline': main.appendChild(renderPipelineView()); break;
  }
  renderModal();
}

function renderScenarioView() {
  const wrap = el('div', 'scenario-shell');
  wrap.appendChild(renderSummaryBar());
  wrap.appendChild(renderOrgSizingPanel());
  wrap.appendChild(renderPresetChips());
  wrap.appendChild(renderEcosystemCanvas());
  wrap.appendChild(renderSelectionsDetail());
  return wrap;
}

function renderOrgSizingPanel() {
  const panel = el('div', 'org-sizing-panel');
  const head = el('div', 'org-sizing-head');
  head.appendChild(el('div', 'org-sizing-title', 'Org sizing'));
  head.appendChild(el('div', 'org-sizing-sub', 'Set once.'));
  panel.appendChild(head);

  const grid = el('div', 'org-sizing-grid');
  for (const [dim, label] of Object.entries(SIZING_LABELS)) {
    const cell = el('label', 'org-sizing-cell');
    if (SIZING_HINTS[dim]) cell.title = SIZING_HINTS[dim];
    cell.appendChild(el('span', 'org-sizing-label', label));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = state.orgSizing[dim] ?? 0;
    input.className = 'org-sizing-input';
    input.addEventListener('change', () => {
      const n = Math.max(0, Number(input.value) || 0);
      state.orgSizing[dim] = n;
      render();
    });
    cell.appendChild(input);
    grid.appendChild(cell);
  }
  panel.appendChild(grid);

  const reset = el('button', 'org-sizing-reset', 'Reset to defaults');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    state.orgSizing = { ...window.MODEL_META.defaultSizing };
    render();
  });
  panel.appendChild(reset);

  return panel;
}

function renderSummaryBar() {
  const total = totalAnnualCost();
  const cov = coverageStats();
  const sc = state.scenarioId ? window.SCENARIOS.find(s => s.id === state.scenarioId) : null;
  const ecoTags = ecosystemTagsInUse();

  const bar = el('div', 'summary-bar');

  const b1 = el('div', 'summary-bar-block');
  b1.appendChild(el('div', 'sb-label', 'Plan'));
  b1.appendChild(el('div', 'sb-value sb-scenario-name',
    sc ? sc.name : (state.scenarioId === 'custom' ? 'Custom' : 'Blank slate')));
  bar.appendChild(b1);

  const b2 = el('div', 'summary-bar-block');
  b2.appendChild(el('div', 'sb-label', 'Annual cost'));
  b2.appendChild(el('div', 'sb-value', fmt$(total) + '/yr'));
  bar.appendChild(b2);

  const b3 = el('div', 'summary-bar-block');
  b3.appendChild(el('div', 'sb-label', 'Capabilities covered'));
  const covWrap = el('div', 'sb-coverage');
  covWrap.appendChild(el('span', 'sb-value', `${cov.covered}/${cov.total}`));
  const covBar = el('div', 'coverage-bar');
  const covFill = el('div', 'coverage-bar-fill');
  covFill.style.width = `${cov.total ? (cov.covered / cov.total) * 100 : 0}%`;
  covBar.appendChild(covFill);
  covWrap.appendChild(covBar);
  b3.appendChild(covWrap);
  bar.appendChild(b3);

  const b4 = el('div', 'summary-bar-block sb-ecosystem');
  b4.appendChild(el('div', 'sb-label', 'Ecosystem mix'));
  const badges = el('div', 'ecosystem-strip');
  for (const [tag, meta] of Object.entries(window.MODEL_META.ecosystems)) {
    const badge = el('span', 'eco-badge');
    badge.textContent = meta.label;
    badge.style.background = meta.color;
    if (!ecoTags.has(tag)) badge.classList.add('muted');
    badges.appendChild(badge);
  }
  b4.appendChild(badges);
  bar.appendChild(b4);

  return bar;
}

function ecosystemTagsInUse() {
  const tags = new Set();
  for (const sol of selectedSolutions()) {
    (sol.ecosystem || []).forEach(t => tags.add(t));
  }
  return tags;
}

function renderPresetChips() {
  const wrap = el('div', 'preset-chips-row');
  wrap.appendChild(el('div', 'preset-chips-label', 'Load template:'));
  const chips = el('div', 'preset-chips');

  // "Blank slate" reset chip
  const blankBtn = el('button', 'preset-chip');
  blankBtn.type = 'button';
  blankBtn.textContent = 'Blank slate';
  blankBtn.title = 'Clear all selections and start from zero.';
  if (state.scenarioId == null) blankBtn.classList.add('active');
  blankBtn.addEventListener('click', () => { loadEmptyBoard(); render(); });
  chips.appendChild(blankBtn);

  for (const sc of window.SCENARIOS) {
    const btn = el('button', 'preset-chip');
    btn.type = 'button';
    btn.textContent = sc.name;
    btn.title = sc.summary;
    if (state.scenarioId === sc.id) btn.classList.add('active');
    btn.addEventListener('click', () => {
      loadScenario(sc.id);
      render();
    });
    chips.appendChild(btn);
  }
  wrap.appendChild(chips);

  const exportBtn = el('button', 'export-btn');
  exportBtn.type = 'button';
  exportBtn.textContent = 'Export Plan (PDF)';
  exportBtn.title = 'Open a print-friendly Digital System Security Plan. Use your browser print dialog to save as PDF.';
  exportBtn.addEventListener('click', exportSummary);
  wrap.appendChild(exportBtn);

  const ciBtn = el('button', 'export-btn export-btn-ci');
  ciBtn.type = 'button';
  ciBtn.textContent = 'Export CI workflow (YAML)';
  ciBtn.title = 'Generate a GitHub Actions workflow file that runs the selected scanners.';
  ciBtn.addEventListener('click', () => {
    state.modal = { type: 'ci-export' };
    render();
  });
  wrap.appendChild(ciBtn);

  return wrap;
}

function renderEcosystemCanvas() {
  const canvas = el('div', 'ecosystem-canvas');
  for (let i = 0; i < window.ECOSYSTEM_LANES.length; i++) {
    canvas.appendChild(renderLane(window.ECOSYSTEM_LANES[i], i));
  }
  return canvas;
}

function capCostFor(capId) {
  const sol = SOLUTIONS_BY_ID[state.selections[capId]] || SOLUTIONS_BY_ID['none'];
  return effectiveCost(sol).annual || 0;
}

function compareCapsByCostThenName(a, b) {
  const ca = capCostFor(a), cb = capCostFor(b);
  if (ca !== cb) return ca - cb;
  return (CAPABILITIES_BY_ID[a]?.name || a).localeCompare(CAPABILITIES_BY_ID[b]?.name || b);
}

function renderLane(lane, index) {
  const node = el('div', 'lane');
  const header = el('div', 'lane-header');
  header.appendChild(el('div', 'lane-index', String(index + 1).padStart(2, '0')));
  header.appendChild(el('div', 'lane-name', lane.name));
  header.appendChild(el('div', 'lane-tag', lane.tagline));
  node.appendChild(header);

  const stack = el('div', 'lane-stack');
  const ordered = [...lane.capabilities].sort(compareCapsByCostThenName);
  for (const capId of ordered) {
    const cap = CAPABILITIES_BY_ID[capId];
    if (!cap) continue;
    stack.appendChild(renderCapCard(cap));
  }
  node.appendChild(stack);
  return node;
}

function renderCapCard(cap) {
  const solId = state.selections[cap.id] || 'none';
  const sol = SOLUTIONS_BY_ID[solId] || SOLUTIONS_BY_ID['none'];
  const unselected = isUnselected(sol);
  const cost = effectiveCost(sol);

  const card = el('button', 'cap-card');
  card.type = 'button';
  card.setAttribute('aria-label', `Solution for ${cap.name}: ${unselected ? 'not selected' : sol.vendor + ' ' + sol.name}. Click to change.`);
  if (unselected) card.classList.add('is-gap');
  else card.classList.add('is-active');

  card.appendChild(el('div', 'cap-card-label', cap.name));

  const body = el('div', 'cap-card-body');
  if (unselected) {
    body.appendChild(el('div', 'cap-card-gap-label', 'not selected'));
    body.appendChild(el('div', 'cap-card-name', 'click to pick a solution'));
  } else {
    body.appendChild(el('div', 'cap-card-vendor', sol.vendor));
    body.appendChild(el('div', 'cap-card-name', sol.name));
  }
  card.appendChild(body);

  const footer = el('div', 'cap-card-footer');
  let costText;
  if (unselected) costText = ',';
  else if (sol.cost.source === 'free') costText = 'free';
  else costText = fmt$(cost.annual) + '/yr';
  footer.appendChild(el('span', 'cap-card-cost', costText));
  footer.appendChild(el('span', 'cap-card-caret', '▾'));
  card.appendChild(footer);

  card.addEventListener('click', () => {
    state.modal = { type: 'pick-solution', capId: cap.id };
    render();
  });

  return card;
}

function renderSelectionsDetail() {
  const wrap = el('div', 'selections-detail');
  wrap.appendChild(el('h3', '', 'Selected solutions (deduplicated)'));

  const grid = el('div', 'selections-detail-grid');
  const solToCaps = new Map();
  for (const [capId, solId] of Object.entries(state.selections)) {
    if (solId === 'none') continue;
    if (!solToCaps.has(solId)) solToCaps.set(solId, []);
    solToCaps.get(solId).push(capId);
  }

  const sorted = [...solToCaps.entries()].sort((a, b) => {
    const sa = SOLUTIONS_BY_ID[a[0]], sb = SOLUTIONS_BY_ID[b[0]];
    if (!sa || !sb) return 0;
    const ca = effectiveCost(sa).annual || 0;
    const cb = effectiveCost(sb).annual || 0;
    if (ca !== cb) return ca - cb;
    return (sa.name || '').localeCompare(sb.name || '');
  });

  if (sorted.length === 0) {
    grid.appendChild(el('div', 'selections-empty',
      'No tools yet.'));
    wrap.appendChild(grid);
    return wrap;
  }

  for (const [solId, caps] of sorted) {
    const sol = SOLUTIONS_BY_ID[solId];
    if (!sol) continue;
    const card = el('div', 'solution-card');

    const head = el('div', 'solution-card-head');
    head.appendChild(el('div', 'solution-card-vendor', sol.vendor));
    const cost = effectiveCost(sol);
    const costEl = el('div', 'solution-card-cost',
      sol.cost.source === 'free' ? 'free' : `${fmt$(cost.annual)}/yr`);
    head.appendChild(costEl);
    card.appendChild(head);

    card.appendChild(el('div', 'solution-card-name', sol.name));
    const capNames = caps.map(c => CAPABILITIES_BY_ID[c]?.name).filter(Boolean).join(' · ');
    card.appendChild(el('div', 'solution-card-cap', `Covers: ${capNames}`));
    const sourceCls = `source-${sol.cost.source}`;
    card.appendChild(el('div', `solution-card-source ${sourceCls}`, sol.cost.source));
    if (sol.cost.note) card.appendChild(el('div', 'solution-card-cap', sol.cost.note));
    if (sol.cost.sourceUrl || sol.cost.contact || (sol.extraSources && sol.extraSources.length)) {
      const meta = el('div', 'solution-card-source-meta');
      meta.appendChild(renderSolutionMeta(sol, { linkClass: 'solution-card-source-line' }));
      card.appendChild(meta);
    }

    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  return wrap;
}

function renderCoverageView() {
  const wrap = el('div', 'coverage-shell');

  const head = el('div', 'section-row');
  const left = el('div');
  left.appendChild(el('h2', '', 'Control coverage matrix'));
  left.appendChild(el('div', 'subtitle',
    'Click a code to read the source. Color shows whether your selections cover the control.'));
  head.appendChild(left);

  const filter = el('div', 'framework-filter');
  for (const fw of ['all', ...FRAMEWORKS]) {
    const chip = el('button', 'fw-chip');
    chip.textContent = fw === 'all' ? 'All' : fw;
    if (state.frameworkFilter === fw) chip.classList.add('active');
    chip.addEventListener('click', () => { state.frameworkFilter = fw; render(); });
    filter.appendChild(chip);
  }
  head.appendChild(filter);
  wrap.appendChild(head);

  const tableWrap = el('div', 'coverage-table-wrap');
  const table = el('table', 'coverage-table');
  table.innerHTML = `<thead><tr>
      <th style="min-width:130px">Framework</th>
      <th style="min-width:90px">Code</th>
      <th>Requirement</th>
      <th style="min-width:140px">Coverage</th>
      <th>Selected solutions</th>
    </tr></thead>`;
  const tbody = document.createElement('tbody');
  const rows = window.CONTROLS.filter(c => state.frameworkFilter === 'all' || c.framework === state.frameworkFilter);
  for (const ctl of rows) {
    const tr = document.createElement('tr');
    const codeCell = ctl.docUrl
      ? `<a class="control-code-link" href="${escapeAttr(ctl.docUrl)}" target="_blank" rel="noopener noreferrer" title="Open canonical reference for ${escapeAttr(ctl.framework)}"><span class="control-code">${escapeText(ctl.code)}</span></a>`
      : `<span class="control-code">${escapeText(ctl.code)}</span>`;
    tr.innerHTML = `
      <td><span class="control-fw">${escapeText(ctl.framework)}</span></td>
      <td>${codeCell}</td>
      <td><span class="control-title">${escapeText(ctl.title)}</span></td>`;

    const status = controlCoverage(ctl);
    const tdStatus = document.createElement('td');
    const cell = el('span', `cov-cell ${status}`);
    cell.textContent = status === 'covered' ? '✓ covered'
      : status === 'partial' ? '~ partial'
      : status === 'gap' ? '✗ gap' : 'n/a';
    tdStatus.appendChild(cell);
    tr.appendChild(tdStatus);

    const tdTools = document.createElement('td');
    const tools = (ctl.capabilities || [])
      .map(capId => {
        const solId = state.selections[capId];
        const sol = solId && solId !== 'none' ? SOLUTIONS_BY_ID[solId] : null;
        const capName = CAPABILITIES_BY_ID[capId]?.name || capId;
        return `<div class="cov-cell-tools"><b>${escapeText(capName)}:</b> ${sol ? escapeText(`${sol.vendor} ${sol.name}`) : '<i>not selected</i>'}</div>`;
      }).join('');
    tdTools.innerHTML = tools;
    tr.appendChild(tdTools);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);
  return wrap;
}

function renderModal() {
  const root = $('#modal-root');
  root.innerHTML = '';
  if (!state.modal) return;
  if (state.modal.type === 'pick-solution') {
    root.appendChild(renderPickerModal(state.modal.capId));
  } else if (state.modal.type === 'ci-export') {
    root.appendChild(renderCiExportModal());
  }
}

function closeModal() {
  state.modal = null;
  render();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.modal) {
    e.preventDefault();
    closeModal();
  }
});

function renderPickerModal(capId) {
  const cap = CAPABILITIES_BY_ID[capId];
  const currentId = state.selections[capId] || 'none';

  const matching = window.SOLUTIONS.filter(s => s.capabilities.includes(capId) || s.id === 'none');
  matching.sort((a, b) => {
    if (a.id === 'none') return 1;
    if (b.id === 'none') return -1;
    const ca = effectiveCost(a).annual || 0;
    const cb = effectiveCost(b).annual || 0;
    if (ca !== cb) return ca - cb;
    return (a.name || '').localeCompare(b.name || '');
  });

  const backdrop = el('div', 'modal-backdrop');
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

  const dialog = el('div', 'modal-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const head = el('header', 'modal-head');
  const headLeft = el('div');
  headLeft.appendChild(el('div', 'modal-eyebrow', cap.domain));
  headLeft.appendChild(el('h2', 'modal-title', `Pick a solution for ${cap.name}`));
  headLeft.appendChild(el('p', 'modal-desc', cap.description || ''));
  head.appendChild(headLeft);

  const closeBtn = el('button', 'modal-close', '×');
  closeBtn.type = 'button';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', closeModal);
  head.appendChild(closeBtn);
  dialog.appendChild(head);

  const list = el('div', 'modal-options');
  for (const sol of matching) {
    list.appendChild(renderPickerOption(capId, sol, currentId));
  }
  dialog.appendChild(list);

  backdrop.appendChild(dialog);
  return backdrop;
}

function renderPickerOption(capId, sol, currentId) {
  const isCurrent = sol.id === currentId;
  const unselected = isUnselected(sol);
  const isFree = sol.cost.source === 'free' && !unselected;
  const cost = effectiveCost(sol);

  const row = el('div', 'modal-option');
  if (isCurrent) row.classList.add('is-current');
  if (unselected) row.classList.add('is-gap');

  const left = el('div', 'modal-option-left');
  if (unselected) {
    left.appendChild(el('div', 'modal-option-name', 'Not selected'));
    left.appendChild(el('div', 'modal-option-vendor-line', 'Leave this capability unfilled. The Coverage matrix will flag any controls that depend on it.'));
  } else {
    left.appendChild(el('div', 'modal-option-vendor-line', sol.vendor));
    left.appendChild(el('div', 'modal-option-name', sol.name));
    const oneLiner = (sol.cost && sol.cost.note) || sol.notes || '';
    if (oneLiner) {
      left.appendChild(el('div', 'modal-option-summary', oneLiner));
    }

    // Compact ecosystem badges stay visible (one row).
    const tags = el('div', 'modal-option-tags');
    for (const tag of (sol.ecosystem || [])) {
      const meta = window.MODEL_META.ecosystems[tag];
      if (!meta) continue;
      const badge = el('span', 'eco-badge');
      badge.textContent = meta.label;
      badge.style.background = meta.color;
      tags.appendChild(badge);
    }
    if (tags.children.length) left.appendChild(tags);

    const hasMore = sol.notes && sol.cost && sol.cost.note && sol.notes !== sol.cost.note
                 || sol.cost.sourceUrl
                 || (sol.extraSources && sol.extraSources.length)
                 || sol.cost.contact;
    if (hasMore) {
      const details = document.createElement('details');
      details.className = 'modal-option-details';
      details.addEventListener('click', e => e.stopPropagation());
      const summary = document.createElement('summary');
      summary.className = 'modal-option-details-summary';
      summary.textContent = 'Details';
      details.appendChild(summary);
      // If both sol.notes AND cost.note exist and differ, include the secondary one in details.
      if (sol.notes && sol.cost && sol.cost.note && sol.notes !== sol.cost.note) {
        details.appendChild(el('div', 'modal-option-note', sol.notes));
      }
      details.appendChild(renderSolutionMeta(sol, { stopPropagation: true }));
      left.appendChild(details);
    }
  }
  row.appendChild(left);

  const right = el('div', 'modal-option-right');
  let priceText, priceCls = '';
  if (unselected) { priceText = ','; priceCls = 'cost-gap'; }
  else if (isFree) { priceText = 'free'; priceCls = 'cost-free'; }
  else { priceText = fmt$(cost.annual) + '/yr'; priceCls = 'cost-paid'; }
  right.appendChild(el('div', `modal-option-cost ${priceCls}`, priceText));
  if (!unselected) {
    right.appendChild(el('div', `modal-option-source-tag source-${sol.cost.source}`, sol.cost.source));
  }

  if (!unselected && !isFree) {
    const dim = sizingDimFor(sol);
    const editor = el('div', 'modal-option-editor');
    editor.appendChild(el('span', 'modal-option-meta-label', `${sol.cost.model}: $`));
    const unitInput = document.createElement('input');
    unitInput.type = 'number'; unitInput.step = '0.01';
    unitInput.value = (state.costOverrides[sol.id]?.unit ?? sol.cost.unit);
    editor.appendChild(unitInput);

    let unitsInput = null;
    if (dim) {
      // Sized model: units come from org sizing. Show what dim drives this.
      const dimLabel = SIZING_LABELS[dim] || dim;
      const tag = el('span', 'modal-option-meta-label modal-option-dim',
        `× ${state.orgSizing[dim]} ${dimLabel.toLowerCase()} (set in Org sizing)`);
      editor.appendChild(tag);
    } else {
      // Non-sized model: units are editable per solution.
      editor.appendChild(el('span', 'modal-option-meta-label', '×'));
      unitsInput = document.createElement('input');
      unitsInput.type = 'number';
      unitsInput.value = (state.costOverrides[sol.id]?.units ?? sol.cost.units);
      editor.appendChild(unitsInput);
    }

    [unitInput, unitsInput].filter(Boolean).forEach(inp => {
      inp.addEventListener('click', e => e.stopPropagation());
      inp.addEventListener('change', () => {
        const ov = state.costOverrides[sol.id] || {};
        ov.unit = Number(unitInput.value);
        if (unitsInput) ov.units = Number(unitsInput.value);
        state.costOverrides[sol.id] = ov;
        if (isCurrent) {
          render();
        } else {
          const c = effectiveCost(sol).annual;
          row.querySelector('.modal-option-cost').textContent = fmt$(c) + '/yr';
        }
      });
    });
    right.appendChild(editor);
  }

  if (isCurrent) {
    right.appendChild(el('div', 'modal-option-current-flag', 'Current selection'));
  } else {
    const selectBtn = el('button', 'modal-option-select', 'Select');
    selectBtn.type = 'button';
    selectBtn.addEventListener('click', e => {
      e.stopPropagation();
      state.selections[capId] = sol.id;
      state.scenarioId = 'custom';
      closeModal();
    });
    right.appendChild(selectBtn);
  }
  row.appendChild(right);

  return row;
}

function renderPipelineView() {
  const wrap = el('div', 'pipeline-shell');

  const head = el('div', 'section-row');
  const ht = el('div');
  ht.appendChild(el('h2', '', 'DevSecOps pipeline'));
  ht.appendChild(el('div', 'subtitle',
    'Click chips to advance enforcement: visibility → soft → hard.'));
  head.appendChild(ht);
  wrap.appendChild(head);

  const calms = el('div', 'calms-strip');
  for (const c of window.CALMS) {
    const card = el('div', 'calms-card');
    card.appendChild(el('div', 'calms-letter', c.letter));
    card.appendChild(el('div', 'calms-name', c.name));
    card.appendChild(el('div', 'calms-sum', c.summary));
    calms.appendChild(card);
  }
  wrap.appendChild(calms);

  const ribbon = el('div', 'pipeline-ribbon');
  ribbon.style.gridTemplateColumns = `repeat(${window.DSO_STAGES.length}, minmax(180px, 1fr))`;
  for (const stage of window.DSO_STAGES) {
    ribbon.appendChild(renderPipelineStage(stage));
  }
  wrap.appendChild(ribbon);

  const bottom = el('div', 'pipeline-bottom-row');
  bottom.appendChild(renderQuickWinsPanel());
  bottom.appendChild(renderPipelineCostPanel());
  wrap.appendChild(bottom);

  return wrap;
}

function renderPipelineCostPanel() {
  const panel = el('div', 'cost-panel');
  panel.appendChild(el('h3', '', 'Annual cost analysis'));

  const total = totalAnnualCost();
  const cov = coverageStats();

  const headRow = el('div', 'cost-panel-head');
  const totalBlock = el('div', 'cost-panel-block');
  totalBlock.appendChild(el('div', 'sb-label', 'Total annual'));
  totalBlock.appendChild(el('div', 'cost-panel-big', fmt$(total)));
  totalBlock.appendChild(el('div', 'cost-panel-sub', 'Across selected tools.'));
  headRow.appendChild(totalBlock);

  const covBlock = el('div', 'cost-panel-block');
  covBlock.appendChild(el('div', 'sb-label', 'Capabilities covered'));
  const covPct = cov.total ? Math.round((cov.covered / cov.total) * 100) : 0;
  covBlock.appendChild(el('div', 'cost-panel-big', `${cov.covered}/${cov.total}`));
  covBlock.appendChild(el('div', 'cost-panel-sub',
    cov.gaps === 0 ? 'No open gaps.' : `${cov.gaps} unselected (${100 - covPct}% gap).`));
  headRow.appendChild(covBlock);
  panel.appendChild(headRow);

  const phaseCounts = { none: 0, visibility: 0, soft: 0, hard: 0 };
  const dsoCapIds = new Set(window.DSO_STAGES.flatMap(s => s.capabilities));
  for (const capId of dsoCapIds) {
    const ph = state.enforcement[capId] || 'none';
    if (ph in phaseCounts) phaseCounts[ph]++;
  }
  const totalDsoCaps = dsoCapIds.size;

  const phaseRow = el('div', 'cost-panel-phases');
  phaseRow.appendChild(el('div', 'sb-label', 'Enforcement maturity'));
  const phaseGrid = el('div', 'phase-rollup');
  for (const ph of window.ENFORCEMENT_PHASES) {
    const cell = el('div', `phase-rollup-cell phase-${ph.id}`);
    cell.appendChild(el('div', 'phase-rollup-count', String(phaseCounts[ph.id])));
    cell.appendChild(el('div', 'phase-rollup-label', ph.label));
    phaseGrid.appendChild(cell);
  }
  phaseRow.appendChild(phaseGrid);
  panel.appendChild(phaseRow);

  const sols = selectedSolutions().filter(s => s.cost.source !== 'free');
  sols.sort((a, b) => effectiveCost(b).annual - effectiveCost(a).annual);
  const topSpend = el('div', 'cost-panel-top');
  topSpend.appendChild(el('div', 'sb-label', 'Largest line items'));
  const list = el('div', 'cost-panel-list');
  for (const sol of sols.slice(0, 5)) {
    const row = el('div', 'cost-panel-row');
    const left = el('div', 'cost-panel-row-left');
    left.appendChild(el('span', 'cost-panel-row-vendor', sol.vendor));
    left.appendChild(el('span', 'cost-panel-row-name', sol.name));
    row.appendChild(left);
    row.appendChild(el('span', 'cost-panel-row-amt', fmt$(effectiveCost(sol).annual) + '/yr'));
    list.appendChild(row);
  }
  if (sols.length === 0) {
    list.appendChild(el('div', 'cost-panel-sub',
      'No paid lines yet. Either everything selected is free / OSS, or no tools have been chosen.'));
  }
  topSpend.appendChild(list);
  panel.appendChild(topSpend);

  return panel;
}

function renderPipelineStage(stage) {
  const node = el('div', 'pipeline-stage');
  node.appendChild(el('div', 'pipeline-stage-name', stage.name));
  node.appendChild(el('div', 'pipeline-stage-tag', stage.tagline));

  const stageSols = new Set();
  const ordered = [...stage.capabilities].sort(compareCapsByCostThenName);
  for (const capId of ordered) {
    const cap = CAPABILITIES_BY_ID[capId];
    if (!cap) continue;

    const capWrap = el('div', 'pipeline-cap');
    capWrap.appendChild(el('div', 'pipeline-cap-name', cap.name));

    const solId = state.selections[capId] || 'none';
    const sol = SOLUTIONS_BY_ID[solId] || SOLUTIONS_BY_ID['none'];
    const unselected = isUnselected(sol);
    const pickerBtn = el('button', 'pipeline-cap-picker');
    pickerBtn.type = 'button';
    if (unselected) pickerBtn.classList.add('is-gap');
    const labelTxt = unselected ? 'not selected' : `${sol.vendor} ${sol.name}`;
    pickerBtn.innerHTML = `<span class="pipeline-cap-tool-name">${escapeText(labelTxt)}</span><span class="pipeline-cap-caret">▾</span>`;
    pickerBtn.addEventListener('click', () => {
      state.modal = { type: 'pick-solution', capId };
      render();
    });
    capWrap.appendChild(pickerBtn);

    const chips = el('div', 'phase-chips');
    chips.title = 'Click to set enforcement: visibility → soft → hard. Click hard to clear.';
    const currentPhase = state.enforcement[capId] || 'none';
    for (const ph of window.ENFORCEMENT_PHASES.filter(p => p.id !== 'none')) {
      const chip = el('div', `phase-chip is-${ph.id}`);
      chip.title = `${ph.label}: ${ph.description}`;
      const isOn = PHASES_BY_ID[currentPhase].order >= ph.order;
      if (isOn) chip.classList.add(`is-on-${ph.id}`);
      chip.addEventListener('click', () => {
        state.enforcement[capId] = ph.id === currentPhase
          ? (ph.id === 'visibility' ? 'none' : window.ENFORCEMENT_PHASES.find(p => p.order === PHASES_BY_ID[currentPhase].order - 1).id)
          : ph.id;
        render();
      });
      chips.appendChild(chip);
    }
    capWrap.appendChild(chips);

    if (solId && solId !== 'none') stageSols.add(solId);

    node.appendChild(capWrap);
  }

  let stageCost = 0;
  for (const solId of stageSols) {
    const sol = SOLUTIONS_BY_ID[solId];
    if (sol) stageCost += effectiveCost(sol).annual;
  }
  const costEl = el('div', 'pipeline-stage-cost');
  costEl.innerHTML = `Stage cost · <b>${stageCost > 0 ? fmt$(stageCost) + '/yr' : (stageSols.size > 0 ? 'free' : ',')}</b>`;
  node.appendChild(costEl);

  if (window.DSO_STAGES.indexOf(stage) < window.DSO_STAGES.length - 1) {
    node.appendChild(el('div', 'pipeline-stage-arrow'));
  }
  return node;
}

function renderQuickWinsPanel() {
  const panel = el('div', 'quickwins-panel');
  panel.appendChild(el('h3', '', 'Quick wins'));
  const list = el('div', 'quickwins-list');
  for (const qw of window.DSO_QUICK_WINS) {
    const sel = state.selections[qw.capability];
    const met = sel && sel !== 'none';
    const item = el('div', 'quickwin-item' + (met ? '' : ' unmet'));
    item.appendChild(el('div', 'quickwin-stage',
      `${STAGES_BY_ID[qw.stage]?.name || qw.stage} · ${met ? 'on track' : 'gap'}`));
    item.appendChild(el('div', '', qw.title));
    list.appendChild(item);
  }
  panel.appendChild(list);
  return panel;
}

// Order stages so the workflow's job graph reads top-to-bottom in SDLC order.
const CI_STAGE_ORDER = ['static', 'build', 'dynamic', 'deploy'];
const CI_STAGE_LABELS = {
  static:  'static-analysis',
  build:   'build-scanning',
  dynamic: 'dynamic-analysis',
  deploy:  'deploy-checks',
};
const CI_STAGE_DESCRIPTIONS = {
  static:  'SAST, secrets, SCA, fast checks against source.',
  build:   'Container, IaC, SBOM, signing, runs on built artifacts.',
  dynamic: 'DAST and runtime checks against a deployed target.',
  deploy:  'Cloud-posture and policy checks against the deployed env.',
};

function ciSelectionsByStage() {
  const byStage = new Map();
  for (const [capId, solId] of Object.entries(state.selections)) {
    if (solId === 'none') continue;
    const sol = SOLUTIONS_BY_ID[solId];
    if (!sol || !sol.ci || !sol.ci.github) continue;
    const block = sol.ci.github;
    const stage = block.stage || 'build';
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push({ sol, capId, block });
  }
  return byStage;
}

function yamlIndent(n) { return '  '.repeat(n); }
function yamlScalar(v) {
  if (v == null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  // Quote if it looks like YAML magic, contains special chars, or has a leading symbol.
  if (/^(true|false|yes|no|null|~)$/i.test(s)) return `'${s}'`;
  if (/^[\s]/.test(s) || /[:#&*!|>'"%@`{}\[\],]/.test(s) || s.includes('\n')) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}
function yamlMap(obj, indent) {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${yamlIndent(indent)}${k}:`);
      lines.push(yamlMap(v, indent + 1));
    } else if (Array.isArray(v)) {
      lines.push(`${yamlIndent(indent)}${k}:`);
      for (const item of v) {
        if (typeof item === 'object') {
          const sub = yamlMap(item, indent + 1).split('\n');
          // Replace the first line's leading whitespace with "- ".
          sub[0] = `${yamlIndent(indent + 1).replace(/  $/, '')}- ${sub[0].trimStart()}`;
          lines.push(sub.join('\n'));
        } else {
          lines.push(`${yamlIndent(indent + 1)}- ${yamlScalar(item)}`);
        }
      }
    } else {
      lines.push(`${yamlIndent(indent)}${k}: ${yamlScalar(v)}`);
    }
  }
  return lines.join('\n');
}

function buildCiWorkflowYaml() {
  const byStage = ciSelectionsByStage();
  const date = new Date().toISOString().slice(0, 10);

  // Banner / header
  const headerLines = [
    `# .github/workflows/security.yml`,
    `# Generated by Security Stack Modeler on ${date}.`,
    `# Selected tools that emit CI steps:`,
  ];
  for (const stage of CI_STAGE_ORDER) {
    const items = byStage.get(stage) || [];
    for (const { sol } of items) {
      headerLines.push(`#   - [${stage}] ${sol.vendor} ${sol.name}`);
    }
  }
  headerLines.push(`# Enforcement: 'visibility' = continue-on-error: true; 'hard' = job fails on findings.`);
  headerLines.push(`# Wire any required secrets (SNYK_TOKEN, GITGUARDIAN_API_KEY, etc.) in repo settings.`);
  headerLines.push(`#`);

  if (byStage.size === 0) {
    headerLines.push(`# No selected tool ships a CI step. Pick OSS scanners (Trivy, Semgrep, Checkov, ZAP, etc.)`);
    headerLines.push(`# or commercial tools with public Actions (Snyk, GitGuardian) to populate this workflow.`);
    return headerLines.join('\n') + '\n';
  }

  const triggers = {
    push: { branches: ['main'] },
    pull_request: { branches: ['main'] },
    workflow_dispatch: null,
  };

  const permissions = { contents: 'read' };

  const root = { name: 'Security checks', on: triggers, permissions, jobs: {} };

  for (const stage of CI_STAGE_ORDER) {
    const items = byStage.get(stage) || [];
    if (items.length === 0) continue;
    const jobName = CI_STAGE_LABELS[stage] || stage;
    const job = {
      'runs-on': 'ubuntu-latest',
      steps: [
        { name: 'Checkout', uses: 'actions/checkout@v4' },
      ],
    };
    for (const { sol, capId, block } of items) {
      const phase = state.enforcement[capId] || 'none';
      const step = { ...block.step };
      // Inject continue-on-error for non-hard enforcement.
      if (phase !== 'hard') step['continue-on-error'] = true;
      job.steps.push(step);
    }
    root.jobs[jobName] = job;
  }

  const onLines = ['on:'];
  onLines.push('  push:');
  onLines.push('    branches: [main]');
  onLines.push('  pull_request:');
  onLines.push('    branches: [main]');
  onLines.push('  workflow_dispatch:');

  const docLines = [];
  docLines.push(`name: Security checks`);
  docLines.push(...onLines);
  docLines.push(`permissions:`);
  docLines.push(`  contents: read`);
  docLines.push(`jobs:`);
  for (const [jobName, job] of Object.entries(root.jobs)) {
    docLines.push(`  ${jobName}:`);
    if (CI_STAGE_DESCRIPTIONS[Object.keys(CI_STAGE_LABELS).find(k => CI_STAGE_LABELS[k] === jobName)]) {
      const stageKey = Object.keys(CI_STAGE_LABELS).find(k => CI_STAGE_LABELS[k] === jobName);
      docLines.push(`    # ${CI_STAGE_DESCRIPTIONS[stageKey]}`);
    }
    docLines.push(`    runs-on: ubuntu-latest`);
    docLines.push(`    steps:`);
    for (const step of job.steps) {
      const stepLines = [];
      let first = true;
      const order = ['name', 'uses', 'run', 'with', 'env', 'continue-on-error'];
      for (const k of order) {
        if (!(k in step)) continue;
        const v = step[k];
        if (v == null) continue;
        if (first) {
          stepLines.push(`      - ${k}: ${typeof v === 'object' ? '' : yamlScalar(v)}`);
          first = false;
          if (typeof v === 'object') {
            // emit object children at one extra indent
            for (const [ck, cv] of Object.entries(v)) {
              stepLines.push(`          ${ck}: ${yamlScalar(cv)}`);
            }
          }
        } else {
          if (typeof v === 'object') {
            stepLines.push(`        ${k}:`);
            for (const [ck, cv] of Object.entries(v)) {
              stepLines.push(`          ${ck}: ${yamlScalar(cv)}`);
            }
          } else {
            stepLines.push(`        ${k}: ${yamlScalar(v)}`);
          }
        }
      }
      docLines.push(stepLines.join('\n'));
    }
  }

  return headerLines.join('\n') + '\n' + docLines.join('\n') + '\n';
}

function renderCiExportModal() {
  const yaml = buildCiWorkflowYaml();

  const backdrop = el('div', 'modal-backdrop');
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

  const dialog = el('div', 'modal-dialog modal-dialog-wide');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const head = el('header', 'modal-head');
  const headLeft = el('div');
  headLeft.appendChild(el('div', 'modal-eyebrow', 'CI workflow export'));
  headLeft.appendChild(el('h2', 'modal-title', '.github/workflows/security.yml'));
  headLeft.appendChild(el('p', 'modal-desc',
    'Drop this file into the .github/workflows directory of any repo. Each selected scanner becomes a step. ' +
    'Capabilities at "visibility" enforcement run with continue-on-error; "hard" enforcement fails the job on findings.'));
  head.appendChild(headLeft);
  const closeBtn = el('button', 'modal-close', '×');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', closeModal);
  head.appendChild(closeBtn);
  dialog.appendChild(head);

  const body = el('div', 'modal-body');
  const actions = el('div', 'ci-export-actions');
  const copyBtn = el('button', 'modal-option-select', 'Copy to clipboard');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(yaml).then(() => {
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => { copyBtn.textContent = 'Copy to clipboard'; }, 1500);
    });
  });
  const dlBtn = el('button', 'modal-option-select', 'Download YAML');
  dlBtn.type = 'button';
  dlBtn.addEventListener('click', () => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'security.yml';
    a.click();
    URL.revokeObjectURL(url);
  });
  actions.appendChild(copyBtn);
  actions.appendChild(dlBtn);
  body.appendChild(actions);

  const pre = document.createElement('pre');
  pre.className = 'ci-export-yaml';
  pre.textContent = yaml;
  body.appendChild(pre);
  dialog.appendChild(body);

  backdrop.appendChild(dialog);
  return backdrop;
}

function exportSummary() {
  const printRoot = $('#print-summary');
  if (!printRoot) return;
  printRoot.innerHTML = '';
  printRoot.appendChild(renderPrintSummary());
  printRoot.hidden = false;
  setTimeout(() => {
    window.print();
    setTimeout(() => { printRoot.hidden = true; }, 500);
  }, 50);
}

function renderPrintSummary() {
  const wrap = el('div', 'print-doc');

  const sc = state.scenarioId ? window.SCENARIOS.find(s => s.id === state.scenarioId) : null;
  const total = totalAnnualCost();
  const cov = coverageStats();
  const today = new Date().toISOString().slice(0, 10);

  const hdr = el('header', 'print-header');
  hdr.appendChild(el('div', 'print-eyebrow', 'Digital System Security Plan'));
  hdr.appendChild(el('h1', 'print-title', sc ? sc.name : (state.scenarioId === 'custom' ? 'Custom plan' : 'Blank plan')));
  if (sc) hdr.appendChild(el('p', 'print-summary', sc.summary));
  hdr.appendChild(el('div', 'print-meta',
    `Generated ${today}. Costs are estimates. Verify with vendor sales.`));
  wrap.appendChild(hdr);

  const covPct = cov.total === 0 ? 0 : Math.round((cov.covered / cov.total) * 100);
  const headline = el('div', 'print-headline');
  const h1 = el('div', 'print-headline-block');
  h1.appendChild(el('div', 'print-label', 'Annual cost'));
  h1.appendChild(el('div', 'print-big', fmt$(total) + '/yr'));
  h1.appendChild(el('div', 'print-sub', 'Sum of incremental annual licensing across all selected solutions.'));
  headline.appendChild(h1);

  const h2 = el('div', 'print-headline-block');
  h2.appendChild(el('div', 'print-label', 'Capabilities covered'));
  const covCls = cov.gaps === 0 ? 'print-big-good' : cov.gaps <= 2 ? 'print-big-warn' : 'print-big-bad';
  h2.appendChild(el('div', `print-big ${covCls}`, `${cov.covered} of ${cov.total} (${covPct}%)`));
  h2.appendChild(el('div', 'print-sub', cov.gaps === 0
    ? 'No open capability gaps in this plan.'
    : `${cov.gaps} unselected capabilit${cov.gaps === 1 ? 'y' : 'ies'} listed below.`));
  headline.appendChild(h2);

  const ecoTags = ecosystemTagsInUse();
  const h3 = el('div', 'print-headline-block');
  h3.appendChild(el('div', 'print-label', 'Ecosystem mix'));
  const mixWrap = el('div', 'print-ecosystem-badges');
  let mixCount = 0;
  for (const [tag, meta] of Object.entries(window.MODEL_META.ecosystems)) {
    if (!ecoTags.has(tag)) continue;
    const b = el('span', 'print-ecosystem-badge', meta.label);
    b.style.background = meta.color;
    mixWrap.appendChild(b);
    mixCount++;
  }
  if (mixCount === 0) {
    mixWrap.appendChild(el('span', 'print-sub', 'No tools selected.'));
  }
  h3.appendChild(mixWrap);
  h3.appendChild(el('div', 'print-sub', 'Tags reflect the mix of OSS, commercial, and cloud-native tools chosen.'));
  headline.appendChild(h3);
  wrap.appendChild(headline);

  const gapList = window.CAPABILITIES.filter(c => !state.selections[c.id] || state.selections[c.id] === 'none');
  if (gapList.length > 0) {
    const gapBox = el('div', 'print-gaps');
    gapBox.appendChild(el('div', 'print-gaps-title', `Unselected capabilities (${gapList.length})`));
    gapBox.appendChild(el('div', 'print-gaps-sub',
      'These capabilities have no tool selected. Each is listed in the Coverage section against the controls that depend on it.'));
    const ul = document.createElement('ul');
    ul.className = 'print-gaps-list';
    for (const g of gapList) {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${escapeText(g.name)}</strong> <span class="print-gaps-domain">${escapeText(g.domain)}</span>`;
      ul.appendChild(li);
    }
    gapBox.appendChild(ul);
    wrap.appendChild(gapBox);
  }

  wrap.appendChild(el('h2', 'print-section', 'Selected solutions'));
  const table = document.createElement('table');
  table.className = 'print-table';
  table.innerHTML = `<thead><tr>
    <th>Capability</th>
    <th>Vendor / product</th>
    <th>Cost basis</th>
    <th>Annual</th>
    <th>Source</th>
    <th>Verify with</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');

  const rows = [];
  for (const cap of window.CAPABILITIES) {
    const solId = state.selections[cap.id];
    if (!solId) continue;
    const sol = SOLUTIONS_BY_ID[solId];
    if (!sol) continue;
    rows.push({ cap, sol });
  }
  rows.sort((a, b) => a.cap.domain.localeCompare(b.cap.domain) || a.cap.name.localeCompare(b.cap.name));

  for (const { cap, sol } of rows) {
    const tr = document.createElement('tr');
    const unselected = isUnselected(sol);
    if (unselected) tr.classList.add('row-gap');
    const cost = effectiveCost(sol);
    const costStr = unselected
      ? ','
      : (sol.cost.source === 'free' ? 'free' : fmt$(cost.annual) + '/yr');
    const sourceStr = sol.cost.sourceUrl
      ? (sol.cost.sourceUrl.startsWith('http')
          ? `<a href="${escapeAttr(sol.cost.sourceUrl)}">${escapeText(shortUrl(sol.cost.sourceUrl))}</a>`
          : escapeText(sol.cost.sourceUrl))
      : '<span class="muted">,</span>';
    const contactStr = sol.cost.contact ? escapeText(sol.cost.contact) : '<span class="muted">,</span>';
    const vendorCell = unselected
      ? '<span class="muted">not selected</span>'
      : `<div class="cell-vendor">${escapeText(sol.vendor)}</div><div class="cell-name">${escapeText(sol.name)}</div>`;
    tr.innerHTML = `
      <td><div class="cell-cap">${escapeText(cap.name)}</div><div class="cell-sub">${escapeText(cap.domain)}</div></td>
      <td>${vendorCell}</td>
      <td>${escapeText(sol.cost.note || sol.cost.model)}</td>
      <td class="cell-cost">${costStr}<div class="cell-sub source-${sol.cost.source}">${sol.cost.source}</div></td>
      <td class="cell-source">${sourceStr}</td>
      <td>${contactStr}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  wrap.appendChild(el('h2', 'print-section', 'Compliance coverage'));
  const covTable = document.createElement('table');
  covTable.className = 'print-table';
  covTable.innerHTML = `<thead><tr>
    <th>Framework</th><th>Code</th><th>Requirement</th><th>Status</th>
  </tr></thead>`;
  const covBody = document.createElement('tbody');
  for (const ctl of window.CONTROLS) {
    const status = controlCoverage(ctl);
    const tr = document.createElement('tr');
    tr.classList.add(`row-${status}`);
    tr.innerHTML = `
      <td>${escapeText(ctl.framework)}</td>
      <td><code>${escapeText(ctl.code)}</code></td>
      <td>${escapeText(ctl.title)}</td>
      <td class="status-${status}">${status === 'covered' ? 'covered' : status === 'partial' ? 'partial' : status === 'gap' ? 'gap' : 'n/a'}</td>`;
    covBody.appendChild(tr);
  }
  covTable.appendChild(covBody);
  wrap.appendChild(covTable);

  wrap.appendChild(el('p', 'print-footer',
    'Costs are estimates. Verify with vendor sales.'));

  return wrap;
}

function escapeText(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function initSplash() {
  const splash = $('#splash');
  if (!splash) return;
  const seen = localStorage.getItem('ssm-splash-seen') === '1';
  if (!seen) splash.hidden = false;
  $('#splash-enter').addEventListener('click', () => {
    splash.hidden = true;
    if ($('#splash-remember-me').checked) localStorage.setItem('ssm-splash-seen', '1');
  });
}

function initTheme() {
  const root = document.documentElement;
  const stored = localStorage.getItem('ssm-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initial = stored || (prefersDark ? 'dark' : 'light');
  root.setAttribute('data-theme', initial);

  const btn = $('#theme-toggle');
  if (!btn) return;
  const SUN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  const MOON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  const setIcon = theme => {
    const ic = btn.querySelector('.theme-toggle-icon');
    if (ic) ic.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
  };
  setIcon(initial);
  btn.addEventListener('click', () => {
    const cur = root.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('ssm-theme', next);
    setIcon(next);
  });
}

function initTabs() {
  $$('.zone-card').forEach(c => {
    c.addEventListener('click', () => {
      state.view = c.dataset.mode;
      render();
    });
  });
}

function boot() {
  loadEmptyBoard();
  initTheme();
  initSplash();
  initTabs();
  render();
}

document.addEventListener('DOMContentLoaded', boot);
