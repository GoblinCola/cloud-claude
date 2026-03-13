# Cloud Claude

Reusable GitHub Actions workflow for running headless Claude Code sessions on any repo in the org.

## Quick Start

1. Copy `caller-template.yml` to `.github/workflows/claude.yml` in your repo
2. Add secrets to your repo (or set at org level):
   - `ANTHROPIC_API_KEY` — Claude API key
   - `PIA_MCP_CLIENT_KEY` — (optional) PIA MCP server key for agent messaging
3. Create an issue, assign someone, and comment `@claude`

## How It Works

```
Issue + @claude comment
  → Caller workflow (your repo)
    → Reusable workflow (this repo)
      → Validate assignee → Create branch → Install Claude CLI
      → Set up PIA hooks + MCP (if key provided)
      → Build prompt from issue + comments + FINAL SPEC
      → Run claude -p with restricted tools
      → Push branch + create PR (or ask clarifying questions)
```

## Features

- **Assignee gate** — Fails early if the issue has no assignee
- **Ambiguity gate** — Claude asks clarifying questions when requirements are vague
- **FINAL SPEC** — Most recent comment containing "FINAL SPEC" is used as primary instruction
- **PIA integration** — Claude messages PIA at start/finish (optional, needs `PIA_MCP_CLIENT_KEY`)
- **Concurrency** — One session per issue at a time
- **Branch isolation** — Work happens on `claude/issue-{N}`, never on main

## Triggers

| Trigger | How |
|---------|-----|
| Comment | Write `@claude` in an issue comment |
| Manual | `gh workflow run claude.yml -f issue_number=42` |
| Programmatic | GitHub API `workflow_dispatch` event |

## Caller Workflow Options

```yaml
uses: GoblinCola/cloud-claude/.github/workflows/claude-session.yml@main
with:
  issue_number: 42                          # required
  additional_instructions: 'Focus on tests' # optional
  model: 'claude-sonnet-4-6'               # optional, default: claude-opus-4-6
  max_turns: 30                             # optional, default: 50
  timeout_minutes: 20                       # optional, default: 30
  extra_allowed_tools: 'Bash(cargo:*)'      # optional, appended to defaults
secrets:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  PIA_MCP_CLIENT_KEY: ${{ secrets.PIA_MCP_CLIENT_KEY }}
```

## Identity Mapping

The workflow maps GitHub assignee → git identity. Currently supported:

| GitHub User | Git Name | Git Email |
|-------------|----------|-----------|
| `goblin-cola` | `Claude-lina.zhukov` | `lina.zhukov@goblin-cola.com` |

Add new mappings in `.github/workflows/claude-session.yml` → "Validate assignee" step.

## Secrets

| Secret | Required | Purpose |
|--------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude Code API access |
| `PIA_MCP_CLIENT_KEY` | No | PIA MCP server auth (enables agent messaging, memory, search) |

Set at org level to share across all repos:
```bash
gh secret set ANTHROPIC_API_KEY --org GoblinCola
gh secret set PIA_MCP_CLIENT_KEY --org GoblinCola
```

## Hooks

The `hooks/` directory contains PIA integration hooks that run during Claude sessions:

- `session-start.js` — Registers agent, loads persistent memory + unread messages
- `prompt-submit.js` — Re-injects context after compaction
- `pre-compact.js` — Archives compaction summary to PIA
- `lib/mcp-client.js` — Streamable HTTP client for PIA MCP server

These are fetched at runtime from this repo — no need to copy them into each project.