# Security Stack Modeler

A static web app for assembling a security program from scratch. Pick a
tool per capability across the SDLC and runtime stack. Get a live annual
budget, control-coverage matrix, DevSecOps pipeline maturity view, and a
"Digital System Security Plan" PDF export.

Vanilla HTML/CSS/JS, no build, no framework.

## Setup

```bash
cd security-stack-modeler
python3 -m http.server 8000
```

Open <http://localhost:8000>. Stop with `Ctrl+C`.

Use the local server: `app.js` is a browser module, so direct `file://`
loading is not a reliable development path. The app has no backend.

## Files

- `index.html`
- `styles.css`
- `data.js`, capabilities, solutions, scenarios, controls, pipeline stages
- `app.js`, state, cost calc, view rendering, PDF export

## Tabs

- **Scenario**. Pick a tool per capability across lifecycle lanes. Live
  annual cost. Export the plan as a PDF.
- **Coverage**. Matrix of NIST CSF 2.0, SOC 2, and NIST SSDF controls against capabilities,
  colored by whether the current selections cover each control.
- **Pipeline**. DevSecOps SDLC ribbon (Plan → Pre-Commit → Build
  → Test → Deploy → Operate). Pick a tool per capability,
  advance visibility / soft / hard enforcement maturity per capability.

## Start-from-zero

The app loads with **no tools selected**. Every capability begins in the
"Not selected" state, and the user explicitly picks each one. There is no
preloaded baseline.

Scenarios are opt-in templates (FOSS-Native, AWS-Native, Azure / Microsoft-Native,
GCP-Native, Enterprise Commercial, GitHub-Native, GitLab-Native) the user can load
to seed the board with a starting point.

## Cost data

All prices are directional estimates from public vendor pricing pages or
free for open-source tools. The solution picker lets the user override annual
unit prices and, for products without an org sizing dimension, quantities.
Per-developer, per-user, and other sized products use the shared Org sizing inputs.

Each solution carries a `source` tag (`estimate` or `free`), a `sourceUrl`
to the published price, and a generic contact role to verify with. Click
any capability card in the app to see all three for that line.

## Tests

Run the offline regression tests with Node.js 24 or newer:

```sh
node --test tests/*.test.mjs
```

The tests cover budget calculations, shared scanner exports, and price-audit
classification without fetching vendor sites.

## License

AGPL-3.0. If you modify this code or run a modified version as a hosted service, you must release your source under AGPL too. For commercial use that does not fit AGPL terms, contact the author to discuss a separate commercial license.
