# Happy Coffee Data Developer Portal

A fictional data developer portal that demonstrates how a web application can expose safe, structured capabilities to AI agents through [WebMCP](https://webmachinelearning.github.io/webmcp/).

Happy Coffee uses deterministic, realistic mock data for datasets, pipelines, data-quality checks, lineage, and platform costs. No portal data is real.

## What it demonstrates

- A React data developer portal with realistic mock assets and operational metrics.
- WebMCP tools for portal search, dataset inspection, pipeline inspection, logs, and cost analysis.

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

## Planned hosted-demo capabilities

The next implementation phase adds a Cloudflare Worker and D1 database for short-lived SQL draft storage. Drafts will be storage-only, size-limited, and automatically expired within two hours.

Deployment will use Cloudflare Workers Builds: pull requests receive preview builds, while merges to `main` automatically deploy production.
