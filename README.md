# AutoFlow

Request features from Telegram or Feishu; an agent (omp) develops them in GitHub Actions, a model reviews the PR, and it merges itself once the project's required checks pass.

Design: [docs/01-方案设计.md](docs/01-方案设计.md).

## Status

| Part            | State     |
| --------------- | --------- |
| Review workflow | available |
| Agent workflow  | planned   |
| Chat Worker     | planned   |

## Add AI review to a project

1. Copy [templates/autoflow-review.yml](templates/autoflow-review.yml) to `.github/workflows/`.
2. Secrets: `AI_BASE_URL`, `AI_API_KEY`, `AUTOFLOW_TOKEN` (fine-grained PAT for that repo: Contents and Pull requests read/write). Variable: `AI_MODEL`.
3. Settings: allow auto-merge, delete branches after merge.
4. Branch protection on the default branch: require PRs, add `autoflow / AI review` plus the project's own checks as required.

## Develop

```sh
pnpm install
pnpm run ci
```
