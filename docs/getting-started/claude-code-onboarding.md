# Claude Code Onboarding

Claude Code is Anthropic's agentic coding tool that runs in your terminal. You give
it a task in plain language and it reads your code, plans an approach, edits files,
runs commands, and reports back — pausing to ask before it does anything risky. This
guide takes you from zero to a productive first session.

> Claude Code evolves quickly. Where this guide would otherwise hardcode versions,
> prices, or model names, it points you at the official docs instead so you always
> get current information: <https://docs.claude.com/en/docs/claude-code>.

## Prerequisites

- A terminal you're comfortable working in.
- [Node.js](https://nodejs.org) (a current LTS release) and `npm`.
- `git` installed, and ideally a git repository to work in — Claude Code is most
  useful inside a project under version control.
- A Claude account (Pro/Max) or an Anthropic API account for authentication.

Claude Code runs on macOS, Linux, and Windows (via WSL). Check the official docs for
the current list of supported platforms and exact version requirements.

## Install

Install the CLI globally with npm:

```bash
npm install -g @anthropic-ai/claude-code
```

Verify the install:

```bash
claude --version
```

If the command isn't found, make sure your npm global `bin` directory is on your
`PATH`.

## Authenticate / first launch

From inside a project directory, start Claude Code:

```bash
cd your-project
claude
```

The first time you launch, Claude Code walks you through authentication. You can sign
in with your Claude account, or authenticate with an Anthropic API key — follow the
on-screen prompts. Once authenticated, you land at an interactive prompt where you can
start typing requests.

## Your first session

Working with Claude Code is a conversation loop:

1. **Prompt** — describe what you want in plain language, for example
   *"Add input validation to the signup form and write a test for it."*
2. **Plan** — Claude inspects the relevant files and figures out an approach. For
   larger tasks it may outline the steps first.
3. **Act** — Claude edits files and runs commands to carry out the work.
4. **Review** — Claude summarizes what it changed. You read the diff, run the code,
   and either accept it or ask for adjustments.

You stay in control the whole time: keep the requests small, review each change, and
iterate. Treat it like pairing with a fast teammate, not a vending machine.

## Essential slash commands

Inside a session, commands that start with `/` control Claude Code itself rather than
sending a prompt. A few you'll use constantly:

- `/help` — list available commands and get usage help.
- `/clear` — clear the current conversation context and start fresh. Use this between
  unrelated tasks so old context doesn't leak in.
- `/init` — scan the project and generate a starter `CLAUDE.md` (see below).
- `/model` — view or switch the model Claude Code is using.

Type `/` at the prompt to see the full, current list — the available commands grow
over time, so `/help` is the source of truth.

## Permissions & safety

Claude Code asks for your approval before doing things that are hard to undo —
editing files, running shell commands, or making network requests. When it proposes an
action you can allow it once, allow that kind of action for the rest of the session,
or decline.

There are different permission modes that trade convenience for caution (from
prompting on every action to running more autonomously). Start conservative while you
learn what Claude does, and loosen permissions only once you trust the workflow. See
the official docs for the current modes and how to configure them.

## CLAUDE.md — project memory

`CLAUDE.md` is a file Claude Code reads automatically and treats as standing
instructions for the project. Put durable context there: how to build and test,
coding conventions, directories to avoid, project-specific gotchas. Anything you'd
otherwise re-explain in every session belongs in `CLAUDE.md`.

Generate a first draft with the `/init` command, then edit it by hand. Keep it
concise and high-signal — it's loaded into context every session, so treat it like a
README for your collaborator rather than an exhaustive manual.

## Extending Claude Code

Two ways to give Claude Code more capabilities, both worth knowing about early but
not required to get started:

- **MCP servers** — the Model Context Protocol lets Claude Code connect to external
  tools and data sources (issue trackers, databases, browsers, internal APIs).
  Configure servers and Claude can call their tools mid-task.
- **Skills & subagents** — reusable, packaged workflows and specialized agents you can
  invoke for specific kinds of work, keeping the main conversation focused.

Both are configurable per project. Reach for them once the basics feel natural; see
the official docs for setup details.

## Tips for good results

- **Be specific.** "Fix the bug" is weak; "the signup form accepts empty emails — add
  validation and a test that an empty email is rejected" gives Claude a verifiable
  goal.
- **Work in small steps.** Smaller tasks are easier to review and correct than one
  giant request.
- **Keep a clean context.** Use `/clear` when you switch tasks so stale context
  doesn't bias the work.
- **Let it verify.** Ask Claude to run tests or the app and confirm the change works,
  rather than trusting that it does.
- **Capture conventions in `CLAUDE.md`** so you stop repeating yourself.
- **Review the diff.** You are the final check — read what changed before you commit.

## Troubleshooting

- **`claude: command not found`** — the npm global bin directory isn't on your
  `PATH`. Run `npm config get prefix` and add its `bin` subdirectory to `PATH`.
- **Authentication problems** — re-run the login flow; check `/help` for the auth
  command, and confirm your account or API key is active.
- **Claude lost track of the task** — the context may be cluttered. Use `/clear` and
  restate the goal concisely.
- **It keeps asking for permission** — that's by design. If a workflow is safe and
  repetitive, adjust the permission mode (see the docs) rather than disabling all
  safeguards.
- **Unexpected or wrong edits** — review the diff and ask Claude to revise; with git
  you can always discard changes and try a smaller prompt.

## Where to go next

- Official documentation: <https://docs.claude.com/en/docs/claude-code>
- Run `/help` inside any session for the current command list.
- Once you're comfortable driving Claude Code by hand, explore **autoloop** in this
  repository for orchestrating multi-iteration agent runs on top of it.
