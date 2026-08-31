<p align="center">
  <img src="./docs/assets/happy-coffee-logo.svg" alt="Happy Coffee Data Developer Portal" width="760" />
</p>

<p align="center">
  <a href="https://webmcp-happy-coffee.pages.dev/"><strong>Explore the live demo</strong></a>
  &nbsp;·&nbsp;
  WebMCP-powered data development in the browser
</p>

A fictional data developer portal that demonstrates how a web application can expose safe, structured capabilities to AI agents through [WebMCP](https://webmachinelearning.github.io/webmcp/).

Happy Coffee uses deterministic, realistic mock data for datasets, pipelines, data-quality checks, lineage, and platform costs. No portal data is real.

## Live demo

Try the deployed portal at [webmcp-happy-coffee.pages.dev](https://webmcp-happy-coffee.pages.dev/).

The site is deployed on Cloudflare Pages from the `main` branch. The portal works in any modern browser; WebMCP tools are available when the visiting AI/browser host supports `document.modelContext`.

## Why WebMCP

Happy Coffee is an example of how WebMCP can accelerate developer productivity. Instead of making people navigate every data-development task by hand, an AI agent can understand the portal, explore the catalog, write and run SQL, create quality checks, prepare a data product, and operate the mock pipeline workflow through structured WebMCP tools.

The portal keeps the work visible and understandable. While the agent does the implementation, people can follow the same journey through sample data, query results, schema details, lineage, quality-check outcomes, and mocked staging executions. Publishing remains an intentional human decision: the agent can prepare the table and its metadata, but a person must click **Publish table**.

## What it demonstrates

- A React data developer portal with realistic mock assets and operational metrics.
- WebMCP tools for autonomous portal navigation, catalog search, dataset inspection, lineage, pipeline inspection, logs, and cost analysis.
- A browser-local DuckDB development workspace with a SQL notebook, result grid, and data explorer.
- WebMCP tools that let an AI agent develop queries, temporary derived tables, and quality checks while the user follows visible feedback in the UI.

## DuckDB development workspace

Open **Develop** from the left navigation to query the generated mock data with DuckDB-Wasm. The workspace seeds every generated portal dataset into the `happy_coffee` schema:

```sql
SELECT variety, SUM(weight_kg) AS inventory_kg
FROM happy_coffee.coffee_inventory
GROUP BY variety
ORDER BY inventory_kg DESC;
```

Create derived tables in the `workspace` schema:

```sql
CREATE TABLE workspace.inventory_by_origin AS
SELECT origin, SUM(weight_kg) AS inventory_kg
FROM happy_coffee.coffee_inventory
GROUP BY origin;
```

DuckDB runs in a dedicated browser worker. Catalog seed data and temporary tables stay on the user’s device; they are never sent to a server. Workspace state resets automatically after 90 minutes and is also cleared by **Reset workspace** or a page refresh. This makes Cloudflare hosting straightforward: no database or server-side execution environment is required for the interactive SQL demo.

## Local development

```bash
npm install
npm run dev
```

The development server starts at `http://localhost:5173`.

## Validation

```bash
npm run lint
npm run test:run
npm run build
```
