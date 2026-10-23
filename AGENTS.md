# AGENTS.md

AutoFlow is developed by AI agents. These rules apply to every change; the review workflow reads this file.

## 1. Verify before pushing

- `pnpm run ci` (typecheck, tests, format check) must pass locally. CI runs the same command.
- Changes go through a PR to `main`; never push to `main` directly.

## 2. Dependencies

- Latest stable release only (no beta, rc, next, canary), pinned to an exact version.
- Add a dependency only when a few lines of code cannot do the job; say why in the PR.

## 3. TypeScript

- Strict `tsconfig.json` is the quality gate; never relax a flag or add `@ts-ignore` / `@ts-expect-error`.
- Only erasable syntax (no `enum`, `namespace`, parameter properties); Node runs `.ts` directly.
- Data from outside the process (HTTP, JSON, CLI output, env, thrown values) is `unknown` until narrowed with `src/core/guard.ts` or `typeof` / `in` checks. No `as` casts to invent a shape.
- No `any`. Prefer `readonly` fields and parameters; private state uses `#fields`.

## 4. Structure

- One feature per directory under `src/` (`review/`, later `worker/`, `agent/`); shared code in `src/core/`.
- Each feature defines its outside-world needs as interfaces in `ports.ts`. Classes implement them as adapters (`gh-pull-requests.ts`, `openai-model.ts`); services (`Reviewer`) depend on the interfaces, injected through the constructor.
- Pure logic (parsing, formatting, prompt building) lives in plain functions with no I/O.
- `main.ts` is the only place that reads env and constructs adapters.
- Add an interface only for a real boundary (I/O, external service, test seam), not for every class.

## 5. Errors

- Intentional failures throw `AutoFlowError` with a code from `ErrorCode`; callers branch on `code`, never on message text.
- Wrap a caught unknown error once, at the boundary that understands it, keeping it as `cause`.
- Never swallow an error silently. Fail closed: when unsure, reject the PR or the request.
- `context` carries structured details for logs and never contains secrets.

## 6. Logging

- Use the injected `Logger`; never `console.*` outside `src/core/log.ts`.
- `msg` is a short constant phrase; variable data goes in fields. Use `child({...})` to bind `repo`, `pr`, `issue`.
- Never log secrets, tokens, or full request bodies that may contain them.

## 7. Tests

- `node:test` + `node:assert/strict`, files next to the code as `*.test.ts`.
- Test behaviour through the public API with fakes for ports; no network.
- Cover decisions and failure paths (fail-closed cases), not wiring.

## 8. Commits and comments

- `<type>(<scope>): <summary>`, one change per commit.
- Comments explain constraints and why, not what the code does.
