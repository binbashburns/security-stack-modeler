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

You can also open `index.html` directly in a browser, the app has no
backend.

## Files

- `index.html`
- `styles.css`
- `data.js`, capabilities, solutions, scenarios, controls, pipeline stages
- `app.js`, state, cost calc, view rendering, PDF export

## Tabs

- **Scenario**. Pick a tool per capability across lifecycle lanes. Live
  annual cost. Export the plan as a PDF.
- **Coverage**. Matrix of NIST CSF 2.0 + SOC 2 controls against capabilities,
  colored by whether the current selections cover each control.
- **Pipeline**. DevSecOps SDLC ribbon (Plan → Pre-Commit → Commit → Build
  → Test → Pre-Release → Deploy → Operate). Pick a tool per stage,
  advance visibility / soft / hard enforcement maturity per capability.

## Start-from-zero

The app loads with **no tools selected**. Every capability begins in the
"Not selected" state, and the user explicitly picks each one. There is no
preloaded baseline.

Scenarios are opt-in templates (FOSS-first, AWS-native, Azure-native,
GCP-native, Enterprise commercial, Greenfield startup) the user can load
to seed the board with a starting point.

## Cost data

All prices are directional estimates from public vendor pricing pages or
free for open-source tools. The Catalog tab lets the user override unit
price and quantity to plug in a real quote during procurement.

Each solution carries a `source` tag (`estimate` or `free`), a `sourceUrl`
to the published price, and a generic contact role to verify with. Click
any capability card in the app to see all three for that line.

## License

AGPL-3.0. If you modify this code or run a modified version as a hosted service, you must release your source under AGPL too. For commercial use that does not fit AGPL terms, contact the author to discuss a separate commercial license.
