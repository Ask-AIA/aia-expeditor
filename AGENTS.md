# AGENTS.md — AIA Expeditor

You are building **AIA Expeditor** for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026).
The complete specification is in [`docs/MUSE_CODE_SPEC.md`](docs/MUSE_CODE_SPEC.md). Read it before every phase.

## Non-negotiable rules

1. **Everything in this repo is new work.** Never copy, recreate, or reference code, schemas, prompts, or internal docs from any other AIA repository. Do not read files outside this repository.
2. **No secrets in git.** Secrets live only in `.env` (git-ignored). `.env.example` holds placeholders. gitleaks runs on pre-commit.
3. **Architecture is enforced.** Hexagonal / Clean layers per `docs/MUSE_CODE_SPEC.md` §5. `domain` imports nothing outside itself. Lint must pass.
4. **TypeScript strict everywhere.** No `any`, no non-null assertions (`!`), no `@ts-ignore`. Validate every external response with Zod.
5. **Every phase ends green:** `pnpm lint && pnpm typecheck && pnpm test` must pass before you report the phase as done.
6. **Small, clear commits** using Conventional Commits (`feat(verification): …`). One concern per commit.
7. **Never invent API shapes for Meta models.** Use the formats in spec §10. If something is unknown, put it behind a port, write a `// VERIFY:` comment, and report it.
8. **Banned categories:** this is not a nutrition, health, or diet advisor. Portion standards are the restaurant's own specification. Never output health or nutrition advice.
9. When a requirement is ambiguous, stop and ask instead of guessing.
