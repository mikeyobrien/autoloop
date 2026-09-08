# Local CI signoff

Prefer one pattern across Mikey repos: **no paid PR runners**. Run the repo's
local gates, then post a GitHub commit status with Basecamp
[`gh-signoff`](https://github.com/basecamp/gh-signoff). Merge requires that
status (context `signoff`).

This file is the autoloop instance of that pattern. Same shape as
[tidy-fleets #22](https://github.com/mikeyobrien/tidy-fleets/pull/22).

## Cost lever

`mikeyobrien/autoloop` is **public**, so Actions minutes are not billed the
same way as a private repo. The PR-burning job was still waste: every pull
request and every push to `main` started `.github/workflows/ci.yml` on
`ubuntu-latest` (`npm ci` → `npm run build` → `npm test`, Node 24). Recent
`ci` runs take about 1.5–2 minutes each (PR + follow-up `main` push doubles
it).

That workflow is removed. Quality gates run locally; `gh signoff` is the
merge receipt.

## Local gates (required before `gh signoff`)

Node.js >= 18 (CI used 24). From the repo root:

```sh
npm ci                 # or npm install
npm run build          # workspaces + root tsc
npm run check          # biome + tsc --noEmit + vitest coverage (>=90%)
```

`npm run check` is the merge-quality gate (`AGENTS.md`). The deleted workflow
only ran `npm run build` and `npm test`; coverage + lint live in `check`.

Record the actual exit codes in the PR. A screenshot or "looks fine" is not a
receipt.

Do **not** talk to tidy-fleets prod dogfood `:4317`.

## Sign off (after green local proof + push)

```sh
gh extension install basecamp/gh-signoff

# HEAD must be on the remote (pushed). Then:
gh signoff
```

That posts commit status **context `signoff`** (description is the git user).
Partial contexts (`gh signoff tests`) are optional; this repo requires the
bare `signoff` context only.

Receipt:

```sh
gh signoff status
# expect: ✓ signoff

# or
gh api "repos/mikeyobrien/autoloop/commits/$(git rev-parse HEAD)/status" \
  --jq '.statuses[] | {context,state,description,created_at}'
```

Paste `gh signoff status` (or the statuses JSON) into the PR. Agents and humans
both prove green the same way: gate exit codes + this status.

## Require `signoff` to merge (Hayes / Mikey, once)

Agents typically cannot write rulesets or branch protection. An admin runs:

```sh
gh extension install basecamp/gh-signoff
cd /path/to/autoloop
gh signoff install
```

`install` creates a repository ruleset named `signoff` that:

- targets the default branch (`main`)
- requires commit status context `signoff`
- blocks force-push and branch deletion (same as old gh-signoff branch protection)
- lets repository admins bypass (same as before)

`gh signoff install` is additive and only manages the `signoff` namespace.
Existing reviews / other rulesets stay in place.

### Manual ruleset equivalent

If the CLI cannot write rulesets from that machine:

1. Repo **Settings → Rules → Rulesets → New ruleset**
2. Name: `signoff` (reserved; gh-signoff treats this name as its own)
3. Enforcement: **Active**
4. Target: `refs/heads/main` (default branch)
5. Rules:
   - Require status checks to pass → add context **`signoff`** (not a GitHub App)
   - Block force pushes
   - Block deletions
6. Bypass: repository admins (optional, matches `gh signoff install`)

Do **not** require the deleted `ci` check. After install, confirm:

```sh
gh signoff check
# reports that signoff is required on main
```

HOLD MERGE on the first signoff PR until Hayes/Mikey run the install (or the
manual ruleset) and accept the pattern.

## What still needs Actions

Keep these publish / deploy workflows:

| Workflow | Trigger | Why it stays |
|---|---|---|
| `.github/workflows/docs.yml` | `push` to `main` on docs paths, or `workflow_dispatch` | VitePress → GitHub Pages |
| `.github/workflows/publish-npm.yml` | `v*` tags or `workflow_dispatch` | npm trusted publish, GitHub Release, standalone binaries |

There is **no** `.github/workflows/release.yml` in tree. GitHub's Actions UI
may still list a leftover **Release** workflow (last useful runs were 2026-03
through 2026-05 on `v0.1.x`). That path is superseded by `publish-npm.yml`.
Hayes/Mikey can disable the orphaned workflow in the Actions UI.

Do not add a PR `ci.yml` (or any `pull_request` test/lint/build job) back.

## Agent / human checklist

1. Run the local gates above. Keep the logs and exit codes.
2. Push the commit.
3. `gh signoff` → `gh signoff status` shows `✓ signoff`.
4. PR body cites the commands, exit codes, and the status receipt.
5. Reviewer merges only when `signoff` is green (after Hayes installs the
   ruleset).
