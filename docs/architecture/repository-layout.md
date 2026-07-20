# Repository Layout Decision

## Status

Accepted on 2026-07-17.

## Decision

Keep the outer `Interview Prep` directory as a local umbrella workspace. Use `interview-arc/` as the Git repository and product boundary.

Inside the repository, keep the existing website build files at the root and add specialist practice areas beside them. Use a root `AGENTS.md` for shared rules, nested `AGENTS.md` files for specialist behavior, and `docs/contracts/` for common formats.

## Why The Website Is Not Under `apps/web/`

The production Cloudflare Worker is configured around root-level
`package.json`, `wrangler.jsonc`, `drizzle/`, and `dist/`. Moving the app into a
package would add build, migration, and deployment risk without improving the
product. `.openai/hosting.json` remains only for the temporary legacy site and
does not define the current production architecture.

If the repository later contains multiple deployable applications, revisit a workspace migration as a separate change with explicit hosting validation.

## Consequences

- The local folder name matches the GitHub repository name.
- Specialist tasks started inside `practice/*/` automatically receive their nested instructions.
- Website tasks started at the root must read `docs/agents/website.md`; tasks under `app/` also receive `app/AGENTS.md`.
- Shared schemas prevent the four specialist workflows from inventing incompatible activity formats.
- Raw audio can live locally inside the repository tree while remaining absent from Git and deployment.
