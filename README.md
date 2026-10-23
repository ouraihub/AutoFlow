# AutoFlow

Request features from Telegram or Feishu; an agent (omp) develops them in GitHub Actions, a model reviews the PR, and it merges itself once the project's required checks pass.

Design: [docs/01-方案设计.md](docs/01-方案设计.md).

## Status

| Part            | State     |
| --------------- | --------- |
| Review workflow | available |
| Agent workflow  | available |
| Chat Worker     | available |

## Add AI review to a project

1. Copy [templates/autoflow-review.yml](templates/autoflow-review.yml) to `.github/workflows/`.
2. Secrets: `AI_KEYS` (one `<https base url> <api key>` per line; the next key is used when one is refused or out of quota), `AUTOFLOW_TOKEN` (fine-grained PAT for that repo: Contents and Pull requests read/write). Variable: `AI_MODEL`.
3. Settings: allow auto-merge, delete branches after merge.
4. Branch protection on the default branch: require PRs, add `autoflow / AI review` plus the project's own checks as required.

## Add the agent to a project

1. Copy [templates/autoflow-agent.yml](templates/autoflow-agent.yml) to `.github/workflows/`; fill `setup` and `checks`.
2. Same secrets and variable as the review. Create the `agent` label.
3. Label an issue `agent` (or send the request from chat). The agent writes `docs/issue-N.md` on `agent/issue-N` and asks you to confirm; reply `确认` to develop, or reply with changes to revise the design.
4. Progress is committed after every design section and task. If a run stops early (timeout, quota), reply `继续`; the next run resumes at the first unchecked task. The PR opens when every task is checked.

## Develop

```sh
pnpm install
pnpm run ci
```
