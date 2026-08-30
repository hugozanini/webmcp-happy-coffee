# WebMCP Happy Coffee

A terminal-free, fictional data catalog that demonstrates how a web application can expose safe, structured capabilities to AI agents through [WebMCP](https://webmachinelearning.github.io/webmcp/).

The Happy Coffee catalog uses deterministic, realistic mock data for datasets, pipelines, data-quality checks, lineage, and platform costs. No catalog data is real.

## What it demonstrates

- A React data catalog with realistic mock assets and operational metrics.
- WebMCP tools for catalog search, dataset inspection, pipeline inspection, logs, and cost analysis.
- A deliberately terminal-free browser surface: the demo does not spawn shells, execute commands, or expose the host file system.

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

The next implementation phase adds a Cloudflare Worker and D1 database for short-lived SQL draft storage. Drafts will be storage-only, size-limited, and automatically expired within two hours. Arbitrary SQL and shell commands will never be executed.

Deployment will use Cloudflare Workers Builds: pull requests receive preview builds, while merges to `main` automatically deploy production.
