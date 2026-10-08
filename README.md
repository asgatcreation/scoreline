# Scoreline

[![CI](https://github.com/asgatcreation/scoreline/actions/workflows/ci.yml/badge.svg)](https://github.com/asgatcreation/scoreline/actions/workflows/ci.yml)
[![License: All rights reserved](https://img.shields.io/badge/license-All%20rights%20reserved-red.svg)](LICENSE)

Real-time football live scores: fast, mobile-first and built for fans in Nigeria and everywhere
else. Live scoreboards, match timelines, line-ups, tables and goal alerts, updated over WebSockets.

> 🚧 In active development. Live demo link, screenshots and full documentation are coming soon.

## Tech stack

| Layer   | Technology                                                            |
| ------- | --------------------------------------------------------------------- |
| Web     | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4         |
| API     | NestJS 12, Socket.IO, Prisma, PostgreSQL (Neon)                       |
| Shared  | `@scoreline/shared`: types and helpers used by both apps              |
| Tooling | pnpm workspaces, Vitest, Playwright, ESLint, Prettier, GitHub Actions |

## Run locally

Requires Node.js 24+ and pnpm 12.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

The web app runs on http://localhost:3001 and the API on http://localhost:4000
(health check: `/healthz`).

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## License

Copyright © 2026 Akanji Oluwaseun Gabriel. **All rights reserved.** This code is public so
clients and reviewers can read it; it may not be copied, modified or reused without written
permission. See [LICENSE](LICENSE).

---

Designed and built by **Akanji Oluwaseun Gabriel** ([@asgatcreation](https://github.com/asgatcreation)).
