# ThoughtCurrent — Product Requirements Document

**Version:** 1.0.0
**Date:** 2026-03-17
**Status:** Finalized

---

## 1. Vision

ThoughtCurrent is a developer tool that compiles text from a wide variety of sources into a single source of truth. It reads from project management tools, communication platforms, observability systems, meeting transcripts, design tools, and local documents — then saves everything verbatim for a given topic or time range.

The end goal: make creating PRDs, subtasks, and product documentation trivially easy because all the research, context, and raw material is already gathered and organized.

ThoughtCurrent runs as a **collaborative Claude Code agent team** — not a collection of solo agents, but a coordinated team that communicates, challenges each other's findings, and builds on shared work.

---

## 2. Language & Stack

- **Runtime:** Bun (TypeScript)
- **Frontend:** Vite + React + shadcn/ui (SPA dashboard)
- **Backend API:** Hono on Bun (REST + WebSocket + SSE for real-time agent progress)
- **Embeddings:** Ollama + nomic-embed-text (Phase 2+, not needed for v1)
- **Agent execution:** Claude Code Agent Teams (experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
- **MCP servers:** For integration access where available
- **V1 storage:** Local markdown files only (no database). Database deferred to Phase 2+.

### Monorepo Structure

```
thoughtcurrent/
  packages/
    server/          # Hono on Bun — API, WebSocket, SSE
    web/             # Vite + React + shadcn/ui — SPA dashboard
    shared/          # Shared TypeScript types (Task, Compilation, etc.)
```

Reference template: [bhvr](https://github.com/stevedylandev/bhvr) (Bun + Hono + Vite + React monorepo with end-to-end type safety).

---

## 3. Supported Sources

### Tier 1 — DeskChief patterns exist, straightforward

| Source | Data Type | Auth Method | MCP Available |
|--------|-----------|-------------|---------------|
| **GitHub** | Issues, PRs, comments, reviews | `gh` CLI (already auth'd) or PAT | Yes (official HTTP) |
| **Linear** | Issues, comments, attachments, relations | Personal API key (`lin_api_`) | Yes (official HTTP) |
| **Granola.ai** | Meeting transcripts, participants, notes | Auto from desktop app (WorkOS) | Yes (official + community) |
| **Slack** | Channel messages, threads, user mentions | Bot token (`xoxb-`) | Yes (official, Feb 2026) |
| **Manual docs** | Markdown, text files, any local files | Local filesystem | N/A |

### Tier 2 — APIs available, needs custom integration

| Source | Data Type | Auth Method | MCP Available |
|--------|-----------|-------------|---------------|
| **Sentry** | Errors, events, stack traces, breadcrumbs | Internal Integration token | No (custom wrapper needed) |
| **Datadog** | Logs, metrics, traces | API Key + Application Key (dual) | Yes (official, GA) |
| **PostHog** | Session replays, event logs, snapshots | Personal API key (scoped) | Yes (official) |
| **Trello** | Cards, lists, boards, comments, checklists | API Key + Token pair | Community MCPs |
| **Figma** | Comments, design metadata, text layers, component descriptions | Personal Access Token or OAuth | Yes (official, polished) |

### Tier 3 — Deferred

| Source | Data Type | Auth Method | MCP Available | Status |
|--------|-----------|-------------|---------------|--------|
| **Microsoft Teams** | Channel messages, chat history, threads | Azure AD app registration | Community only | Deferred — Azure AD complexity too high for MVP |

---

## 4. Authentication Strategy

### Token Discovery Chain (per DeskChief pattern)

1. **Environment variable** — e.g. `SLACK_BOT_TOKEN`, `LINEAR_API_KEY`
2. **Config file** — `~/.config/thoughtcurrent/config.json`
3. **CLI credentials** — tool-specific credential files (e.g. `~/.config/linear/credentials.toml`)
4. **MCP discovery** — Claude Desktop config, `.claude/settings.local.json`

### All tokens are read-only

Every integration requests the minimum scopes needed to read data. No write access is ever requested or used.

### Reuse existing auth (Conductor pattern)

Do not ask users to create new accounts or configure new API keys if they already have them. Detect and reuse what's already on the machine — `gh auth status`, Linear CLI credentials, Granola desktop app tokens, Claude Desktop MCP configs.

### Per-source authentication guides

Documentation will include step-by-step guides with screenshots for obtaining read-only tokens from each service:

- **GitHub:** `gh auth login` or generate fine-grained PAT with `repo:read`, `read:org`
- **Slack:** Create app at api.slack.com → OAuth & Permissions → add `channels:read`, `channels:history`, `users:read` → copy bot token
- **Linear:** Settings → API → Personal API Keys → create key
- **Granola:** Install desktop app → log in → tokens auto-discovered from `~/Library/Application Support/Granola/supabase.json`
- **Sentry:** Settings → Developer Settings → Internal Integration → scopes: `event:read`, `project:read`, `org:read`
- **Datadog:** Organization Settings → API Keys + Application Keys (scoped to `logs_read`)
- **PostHog:** Account Settings → Personal API Keys → scopes: `session_recordings:read`, `events:read`
- **Trello:** trello.com/app-key → generate read-only token
- **Figma:** Settings → Security → Personal access tokens (or OAuth via MCP)
- **Microsoft Teams:** Deferred

---

## 5. Product Flow

### Step 1: Authentication

User configures tokens for their desired sources. ThoughtCurrent provides:

- A status dashboard showing which integrations are connected / not configured / errored
- Health checks per integration (following DeskChief's `status.ts` pattern)
- Clear error messages with links to setup docs

### Step 2: Filtering

User specifies what to pull:

- **Date range filter** — required: start date, end date
- **Topic/keyword filter** — optional: only pull items matching certain terms
- **Source selection** — which integrations to query

### Step 3: Compilation

The team lead spawns compiler agents as teammates. They query each source in parallel, save all text verbatim, and report findings back to the team:

- Each source gets its own teammate (read-only, parallel execution)
- Raw text saved as local markdown files with full metadata (source, author, timestamp, URL)
- **V1: no database** — output is purely local files in the output directory
- **Incremental compilation** — if content already exists locally/cached, skip re-fetching
- Agents communicate progress via SendMessage to team lead
- Progress visible in UI — which sources are done, how many items found

### Context Window Management

Teammates are monitored via the token usage status line script (`~/.claude/statusline-command.sh`). When a teammate's context window reaches ~80% utilization:

1. Team lead sends a shutdown request via SendMessage
2. Teammate compacts its output so far and writes it to the output directory
3. Teammate goes idle
4. Team lead spawns a fresh teammate to continue from where the previous one left off
5. New teammate reads the output directory to orient itself — fresh context, no rot

This keeps all sessions in the "smart zone" (~40% context utilization) per the Ralph Wiggum pattern.

### Step 4: Output

A compilation directory is generated containing:

```
output/
├── github/
│   ├── issues.md
│   └── pull-requests.md
├── slack/
│   └── channels.md
├── linear/
│   └── issues.md
├── granola/
│   └── transcripts.md
├── sentry/
│   └── errors.md
├── datadog/
│   └── logs.md
├── posthog/
│   └── sessions.md
├── trello/
│   └── cards.md
├── figma/
│   └── comments.md
├── manual/
│   └── uploaded-docs.md
└── _compiled.md          ← single file, everything merged chronologically
```

---

## 6. Phased Roadmap

### Phase 1: Compile (MVP)

**Goal:** Single source of truth. Pull text from all configured sources, save verbatim.

- Authentication setup + status dashboard
- Date range + keyword filtering
- Collaborative agent team (read-only) via Claude Code Agent Teams
- Verbatim text storage as local markdown files (no database for v1)
- Incremental compilation — skip already-cached content
- Compiled output directory
- Web dashboard (Vite + React + shadcn/ui) showing compilation progress
- AI-generated summary cards for compiled documents

**Agent team structure:**

```
Team Lead (main Claude Code session)
├── compiler-github (teammate)
├── compiler-slack (teammate)
├── compiler-linear (teammate)
├── compiler-granola (teammate)
├── compiler-sentry (teammate)
├── compiler-datadog (teammate)
├── compiler-posthog (teammate)
├── compiler-trello (teammate)
├── compiler-figma (teammate)
├── compiler-manual (teammate)
└── compiler-teams (deferred)
```

All compiler teammates use tools: `["Read", "Glob", "Grep"]` + source-specific MCP tools (`mcp__<source>__*`).

Teammates report findings back to the team lead via SendMessage. The team lead monitors shared task list and synthesizes the final `_compiled.md`.

### Phase 2: Research & Questions (Bidirectional Planning)

**Goal:** Identify gaps, edge cases, and outstanding questions from the compiled material. Uses the Ralph Wiggum "bidirectional planning" pattern — human and Claude ask each other questions until specs are aligned.

**Two sub-phases:**

**2a. Developer Interview (pre-research)**
Before autonomous research begins, the chat-facilitator interviews the developer:
- What are you building? What gaps do you anticipate?
- What questions matter most? What's the riskiest assumption?
- Output: `specs/research-focus.md` that drives the autonomous research

**2b. Autonomous Research + Follow-up Q&A**
- Researcher agents cross-reference compiled docs, challenge each other's analysis
- Question generator identifies what's missing or unclear
- Post-research: Claude presents findings and asks the developer follow-up questions
- Outstanding questions saved as structured Q&A document

**Agent team structure:**

```
Team Lead
├── researcher-semantic (analyzes meaning, conceptual relationships)
├── researcher-structural (identifies patterns, organizational structure)
├── question-generator (produces structured questions from gaps)
└── chat-facilitator (manages interactive Q&A with the developer)
```

Researchers **message each other directly** to challenge findings and build consensus. This is the key difference from solo agents — they collaborate like a scientific debate.

Research agents have access to `WebSearch` and `WebFetch` tools for external context. **Malware protection**: PreToolUse hooks validate fetched URLs against known-safe domains and block executable downloads, script injection, and suspicious redirects.

### Phase 3: PRD & Subtask Generation

**Goal:** Generate production-quality PRDs and subtasks from compiled + researched material.

**Three sub-phases (inspired by spec-kit + Task Master):**

**3a. Specification Generation**
- PRD writer synthesizes all material into a structured spec
- Follows spec-kit's template: user scenarios with Given/When/Then acceptance criteria, numbered functional requirements (`FR-###`), measurable success criteria (`SC-###`)
- Includes a "constitution" — immutable project principles that govern the spec
- Clarification pass: scan for ambiguity, generate max 5 targeted questions, integrate answers

**3b. Complexity Analysis + Task Decomposition**
- Task analyzer scores each section of the PRD on complexity (1-10)
- Two-phase decomposition: PRD → coarse parent tasks (10-25) → subtasks per complex task
- Dependency-aware sequencing: dependencies only reference lower IDs (prevents circular refs)
- Each task gets: id, title, description, status, dependencies, priority, details, testStrategy
- `expansionPrompt` pattern: complexity analysis generates tailored guidance per task, which feeds the subtask expansion

**3c. Quality Validation**
- Consistency analysis across all artifacts (spec-kit's analyze pattern)
- Checks: duplication, ambiguity, underspecification, coverage gaps, inconsistency
- Checklist pass: "Are requirements complete, clear, consistent, measurable?"
- Traceability: every task traces back to a spec requirement, every requirement traces to compiled research

**Agent team structure:**

```
Team Lead
├── spec-writer (synthesizes compiled docs + research into spec)
├── task-analyzer (complexity scoring, decomposition strategy)
├── task-generator (creates dependency-ordered tasks + subtasks)
└── quality-validator (cross-artifact consistency checks)
```

- **Output is local markdown only** — no automatic export
- User manually creates GitHub issues from the GUI via button clicks after review
- The only way to push issues/subtasks is via explicit user action in the UI
- AI-generated summary cards for subtasks and PRDs in the dashboard
- Version tracking for PRD iterations

---

## 7. Agent Architecture

### Claude Code Agent Teams

ThoughtCurrent uses Claude Code's experimental agent teams feature — not subprocess spawning, not solo subagents, but a **collaborative team with a shared task list and direct inter-agent messaging**.

**Requirements:**
```json
// .claude/settings.json or settings.local.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

### How the Team Works

1. **Team Lead** is the main Claude Code session. It creates the team, spawns teammates, assigns tasks, and synthesizes results.
2. **Teammates** are independent Claude Code instances, each with their own context window. They claim tasks from the shared task list, execute them, and report back.
3. **Communication** happens via:
   - **SendMessage** — direct teammate-to-teammate messaging (e.g., researcher-semantic sends findings to researcher-structural for cross-referencing)
   - **Broadcast** — send to all teammates (sparingly, due to token cost)
   - **Shared task list** — all agents see task status; when one completes, dependent tasks unblock
   - **Idle notifications** — teammates auto-notify the lead when they finish
4. **Plan approval** — the team lead can require plan approval before teammates make changes. Teammates work in read-only plan mode, submit their plan, lead approves or rejects with feedback.

### Quality Gate Hooks

```json
{
  "hooks": {
    "TeammateIdle": [{
      "hooks": [{ "type": "command", "command": ".claude/hooks/validate-compilation.sh" }]
    }],
    "TaskCompleted": [{
      "hooks": [{ "type": "command", "command": ".claude/hooks/verify-task-output.sh" }]
    }]
  }
}
```

- **TeammateIdle**: When a compiler teammate finishes, validate its output meets ThoughtCurrent standards before allowing it to go idle. Exit code 2 sends feedback and the teammate continues working.
- **TaskCompleted**: When a task is marked complete, verify the output files exist, content is non-empty, and metadata is valid. Exit code 2 rejects completion with feedback.

### Fresh Context Pattern (Ralph Wiggum Loop)

For long-running compilations (large date ranges, many sources), each compilation task can be structured as a Ralph-style loop:

- Each iteration gets fresh context — no accumulated conversation history, no context rot
- The spec files and output directory are the source of truth, not prior conversation
- One task per iteration keeps each agent in the "smart zone" (~40% context utilization)
- Completion is mechanically verifiable: all items within date range fetched and written

### Coordination Through Shared State (C Compiler Pattern)

Inspired by Anthropic's 16-agent C compiler build:

- Agents coordinate through the **shared filesystem** (output directory, task list) — not just direct messaging
- **Task locking** prevents duplicate work: if compiler-github is processing issues, no other agent touches GitHub
- **Progress documentation** maintained by agents themselves — each reads what others have done before deciding next task
- When a monolithic task appears (e.g., 6 months of Slack), break it into independent subsets (per-channel, per-week) for parallel processing

### Safety Model (Defense in Depth)

1. **Tool allowlists** — compiler agents only get Read/Glob/Grep + source-specific MCP tools
2. **PreToolUse hooks** — shell scripts that block Write, Edit, Bash destructive commands, git push, gh pr merge
3. **Prompt-level safety rules** — injected into every agent: "You are read-only. You MUST NOT modify any files, push code, or call write APIs."
4. **`dangerouslyDisablePermissions`** used for speed, but constrained by layers above
5. **Per-project database isolation** — each ThoughtCurrent run has its own data
6. **Quality gate hooks** — TeammateIdle and TaskCompleted verify output before accepting

### Structured Output Protocol

Agents emit structured blocks for reliable parsing:

```
<<<TC_COMPILATION>>>
{
  "source": "github",
  "items": [...],
  "metadata": { "dateRange": "...", "query": "..." }
}
<<<END_TC_COMPILATION>>>
```

---

## 8. Specification-Driven Development (spec-kit Patterns)

ThoughtCurrent adopts key patterns from GitHub's spec-kit to ensure generated PRDs are actually useful:

### Constitution

Each ThoughtCurrent project starts with a `constitution.md` — immutable principles that govern all generated specs:

```markdown
# ThoughtCurrent Constitution v1.0

1. Read-Only: ThoughtCurrent never modifies source systems
2. Verbatim-First: raw text is preserved before any synthesis
3. Source-Attributed: every piece of content traces to its origin
4. Date-Bounded: all queries respect explicit date ranges
5. Incrementally-Valuable: Phase 1 output is useful even without Phase 2/3
```

All generated specs are validated against the constitution. Violations are flagged as CRITICAL.

### Structured Requirement IDs

All generated artifacts use traceable ID schemes:

- `RF-###` — Research Finding (from compiled material)
- `FR-###` — Functional Requirement (in generated spec)
- `SC-###` — Success Criteria (measurable)
- `T-###` — Task (from decomposition)
- `CHK-###` — Checklist item (quality validation)

Cross-references create a traceable chain: `RF-001` → `FR-003` → `T-007` → `CHK-012`

### Acceptance Criteria Format

All user stories in generated specs use Given/When/Then:

```
**US-001: Developer compiles Slack messages** (P1)

Given: The developer has configured a Slack bot token
And: They specify a date range of 2026-03-01 to 2026-03-15
When: They run the compilation
Then: All messages from accessible channels within that date range are saved
And: Each message includes author, timestamp, channel name, and thread context
And: The output is written to output/slack/channels.md
```

### Clarification Loop

After initial spec generation, ThoughtCurrent runs a clarification pass:
1. Scan the spec for ambiguous terms, undefined references, `NEEDS CLARIFICATION` markers
2. Generate max 5 targeted questions per session
3. Present to the developer via the chat-facilitator
4. Integrate answers back into the spec
5. Repeat until no ambiguities remain

### Cross-Artifact Consistency Analysis

Before finalizing any output, run a 6-axis analysis:
1. **Duplication** — near-duplicate requirements or findings
2. **Ambiguity** — vague terms without metrics, unresolved placeholders
3. **Underspecification** — missing acceptance criteria, undefined references
4. **Constitution Alignment** — violations of project principles
5. **Coverage Gaps** — requirements without tasks, orphaned tasks
6. **Inconsistency** — terminology drift, conflicting requirements

---

## 9. Task Decomposition (Task Master Patterns)

ThoughtCurrent adopts Task Master's proven patterns for breaking specs into actionable work:

### Three-Phase Pipeline

```
Spec → Complexity Analysis → Task Expansion
```

1. **Parse spec** → generate 10-25 coarse parent tasks, dependency-ordered
2. **Analyze complexity** → score each task 1-10, generate `expansionPrompt` per task
3. **Expand complex tasks** → generate 3-7 subtasks for tasks scoring above threshold (default: 5)

### Task Schema (Zod-validated)

```typescript
// Every generated task follows this structure
{
  id: string,              // "T-001"
  title: string,           // 5-200 chars
  description: string,     // what this task accomplishes
  status: "pending" | "in-progress" | "blocked" | "done" | "cancelled" | "deferred",
  dependencies: string[],  // ["T-001", "T-003"] — only lower IDs allowed
  priority: "low" | "medium" | "high" | "critical",
  details: string,         // implementation instructions
  testStrategy: string,    // how to verify completion
  complexityScore: number, // 1-10 from analysis
  subtasks: Subtask[],     // expanded child tasks
  traceability: string[],  // ["FR-003", "RF-001"] — linked requirements
  exportedTo: object | null // { linear: "ISSUE-123" } or { github: "org/repo#45" }
}
```

### Dependency-Aware Sequencing

- Dependencies only reference lower IDs (prevents circular refs by construction)
- "Next task" algorithm: filter to tasks whose deps are all `done`, rank by priority
- Phase ordering: Setup → Foundational → Feature tasks → Polish

### Codebase-Aware Expansion

When generating subtasks for a project that already has code, inject Read/Glob/Grep capabilities so the task-generator bases subtasks on actual file structure and patterns — not generic templates.

---

## 10. Data Model

### V1: Local File System (No Database)

All output is stored as local markdown files. No database required for Phase 1.

```
output/
├── .meta/
│   ├── compilation.json       ← compilation metadata (date range, sources, status)
│   ├── cache.json             ← tracks fetched items for incremental compilation
│   └── summaries.json         ← AI-generated summaries for dashboard cards
├── github/
│   ├── issues.md
│   └── pull-requests.md
├── slack/
│   └── channels.md
├── linear/
│   └── issues.md
├── granola/
│   └── transcripts.md
├── sentry/
│   └── errors.md
├── datadog/
│   └── logs.md
├── posthog/
│   └── sessions.md
├── trello/
│   └── cards.md
├── figma/
│   └── comments.md
├── manual/
│   └── uploaded-docs.md
├── _compiled.md               ← single file, everything merged chronologically
├── research/                  ← Phase 2 output
│   ├── questions.md
│   └── findings.md
└── specs/                     ← Phase 3 output
    ├── constitution.md
    ├── spec.md
    └── tasks.md
```

### Incremental Compilation

`cache.json` tracks previously fetched items by source + externalId. On re-run, agents check the cache and skip items already present locally. This enables efficient re-compilation when only new content needs fetching.

### Phase 2+ Database (Future)

When vector search and semantic dedup are needed (Phase 2+), add PostgreSQL + pgvector:

```
documents
  id: string (primary)
  source: enum (github, slack, linear, granola, sentry, datadog, posthog, trello, figma, manual)
  externalId: string? (unique per source)
  title: string
  content: text (verbatim)
  author: string?
  sourceUrl: string?
  sourceTimestamp: datetime
  embedding: vector(768)?
  fingerprint: string? (SHA-256)
  metadata: jsonb

research_questions
  id: string (primary)
  question: text
  context: text
  answer: text?
  status: enum (open, answered, deferred)

tasks
  id: string (primary)
  parentTaskId: string? (FK → tasks)
  title: string
  description: text
  status: enum (pending, in-progress, blocked, done, cancelled, deferred)
  priority: enum (low, medium, high, critical)
  dependencies: string[]
  complexityScore: int? (1-10)
  traceability: string[]
```

---

## 11. MCP Server Configuration

### Recommended MCP servers for ThoughtCurrent agents

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" }
    },
    "slack": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-slack"],
      "env": { "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}" }
    },
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "headers": { "Authorization": "Bearer ${LINEAR_API_KEY}" }
    },
    "datadog": {
      "type": "http",
      "url": "${DATADOG_MCP_URL}",
      "headers": {
        "DD-API-KEY": "${DATADOG_API_KEY}",
        "DD-APPLICATION-KEY": "${DATADOG_APP_KEY}"
      }
    },
    "posthog": {
      "command": "npx",
      "args": ["@posthog/mcp-server"],
      "env": { "POSTHOG_API_KEY": "${POSTHOG_API_KEY}" }
    },
    "figma": {
      "type": "http",
      "url": "https://figma.com/mcp",
      "headers": { "Authorization": "Bearer ${FIGMA_ACCESS_TOKEN}" }
    },
    "trello": {
      "command": "npx",
      "args": ["mcp-server-trello"],
      "env": {
        "TRELLO_API_KEY": "${TRELLO_API_KEY}",
        "TRELLO_TOKEN": "${TRELLO_TOKEN}"
      }
    }
  }
}
```

Sentry and Microsoft Teams will use direct REST API calls (no MCP yet).

---

## 12. Configuration

### Minimal surface area (Conductor pattern)

Following Conductor's philosophy: convention over configuration with escape hatches. The entire config is one JSON file + environment variables. No DSL, no YAML, no complex schemas.

```json
// ~/.config/thoughtcurrent/config.json
{
  "databaseUrl": "postgresql://localhost:5432/thoughtcurrent",
  "ollamaUrl": "http://localhost:11434",
  "agent": {
    "maxConcurrent": 6,
    "defaultTimeoutMs": 600000
  },
  "integrations": {
    "github": { "enabled": true },
    "slack": { "enabled": true, "token": "" },
    "linear": { "enabled": true, "apiKey": "" },
    "granola": { "enabled": true },
    "sentry": {
      "enabled": false,
      "orgId": "",
      "projectId": "",
      "authToken": ""
    },
    "datadog": {
      "enabled": false,
      "apiKey": "",
      "appKey": "",
      "region": "us"
    },
    "posthog": {
      "enabled": false,
      "apiKey": "",
      "baseUrl": "https://app.posthog.com"
    },
    "trello": {
      "enabled": false,
      "apiKey": "",
      "token": ""
    },
    "figma": {
      "enabled": false,
      "accessToken": ""
    },
    "teams": {
      "enabled": false,
      "tenantId": "",
      "clientId": "",
      "clientSecret": ""
    }
  }
}
```

### Team-shareable config (Conductor pattern)

A `thoughtcurrent.json` in the repo root can be committed to share config with teammates:

```json
{
  "constitution": "constitution.md",
  "defaultSources": ["github", "linear", "slack", "granola"],
  "defaultDateRange": "30d",
  "outputDir": "output"
}
```

---

## 13. Security Requirements

- All integrations are **read-only** — no write scopes requested, no mutations performed
- Tokens stored in environment variables or local config (never committed to git)
- PreToolUse hooks block all write operations at the Claude Code level
- Agent tool allowlists restrict to Read/Glob/Grep + MCP read tools
- TeammateIdle and TaskCompleted hooks verify output quality
- Per-compilation database isolation
- Token refresh handled automatically where supported (Granola WorkOS, OAuth flows)
- Rate limiting: 5-minute TTL caching on all API responses
- Audit logging: every API call logged with source, timestamp, items fetched

---

## 14. UI (Vite + React + shadcn/ui)

Following Conductor's "visibility without interruption" pattern:

- **Compilation dashboard** — single view showing all teammates' status (air traffic control pattern)
  - Which sources are compiling, done, or errored
  - Item counts per source
  - Real-time progress updates via WebSocket from Hono backend
  - Context window usage per teammate (from status line script)
- **AI summary cards** — shadcn/ui Card + Badge components showing:
  - Compiled document summaries per source
  - PRD sections with key findings
  - Subtask cards with priority, status, dependencies
  - All generated from AI summaries, linking to full verbatim markdown
- **Integration status** — connected / not configured / error per source
- **Token setup wizard** — step-by-step guides with deep links to each service
- **Filter configuration** — date range picker, keyword input, source toggles
- **Output browser** — view compiled markdown by source, search across all
- **Manual export** — "Create GitHub Issue" button per task/subtask. Only pushes on explicit user click.
- **Phase 2 Q&A** — interactive chat with the research facilitator (shadcn/ui AI chat components with streaming markdown via Streamdown)
- **Checkpoint/rollback** (Conductor pattern) — automatic snapshots of compilation state, revertible if something goes wrong

Component references: shadcn-admin template for layout, shadcn-data-views for kanban/grid/gallery task views, Assistant UI for chat interface.

Should be usable by developers who are not the original author.

---

## 15. Documentation Requirements

- README with quick-start guide (near-zero setup, Conductor-style)
- Per-integration setup guides with screenshots and deep links
- Architecture overview for contributors
- CLAUDE.md with project conventions and safety rules
- Example compilation output
- MCP server configuration reference
- Constitution template + examples
- Spec template (Given/When/Then format)
- Task schema reference

---

## 16. Reference Implementations

### DeskChief

`/Users/jacksonogles/work/deskchief` — battle-tested patterns for agent orchestration:

| Pattern | DeskChief File | ThoughtCurrent Use |
|---------|---------------|-------------------|
| Agent spawning + guardrails | `src/agents/spawn.ts` | Reference for safety hooks |
| Integration auth discovery | `src/integrations/linear.ts` | Token discovery chain |
| Vector memory + search | `src/memory/index.ts` | Document embedding + dedup |
| Deduplication | `src/lib/dedup.ts` | Cross-source dedup |
| Integration health checks | `src/integrations/status.ts` | Status dashboard |
| Structured output parsing | `src/agents/task-parser.ts` | `<<<TC_COMPILATION>>>` blocks |
| Config management | `src/config/index.ts` | Config loading + env override |
| Multi-stage pipeline | `src/agents/pipeline.ts` | Phase 1 → 2 → 3 flow |
| Task-inbox cascading | `src/lib/task-cascades.ts` | Compilation status sync |
| Database schema | `prisma/schema.prisma` | Data model template |

### spec-kit

`github/spec-kit` — specification-driven development:

| Pattern | ThoughtCurrent Use |
|---------|-------------------|
| Constitution (immutable principles) | Govern all generated specs |
| 6-step pipeline (constitution → spec → clarify → plan → tasks → implement) | Phase 3 spec generation flow |
| Given/When/Then acceptance criteria | User story format in generated specs |
| Structured IDs (FR-###, SC-###, T-###) | Traceable requirement chains |
| Clarification loop (max 5 questions) | Phase 2 ambiguity resolution |
| Cross-artifact consistency analysis | Quality validation before output |
| Checklist system (unit tests for requirements) | Spec quality gates |

### Task Master

`task-master-ai` — PRD to subtask decomposition:

| Pattern | ThoughtCurrent Use |
|---------|-------------------|
| Three-phase pipeline (parse → analyze → expand) | Phase 3b task decomposition |
| Complexity scoring (1-10) | Prioritize which tasks need subtasks |
| `expansionPrompt` per task | Tailored guidance for subtask generation |
| Dependency-aware sequencing | Prevents circular refs, enables "next task" |
| Codebase-aware expansion | Subtasks based on actual project structure |
| Zod-validated task schema | Structured, predictable output |

### Conductor

`conductor.build` — developer experience for autonomous agents:

| Pattern | ThoughtCurrent Use |
|---------|-------------------|
| Near-zero setup (drag and drop) | Minimal config, reuse existing auth |
| 3 lifecycle scripts (setup/run/archive) | Simple, shell-based customization |
| Workspace isolation via git worktrees | Per-compilation isolation |
| Visibility dashboard (air traffic control) | Compilation progress UI |
| Checkpoint/rollback | Revert compilation state |
| Review gates, not permission gates | Let agents work, then review output |

### Ralph Wiggum Loop

Autonomous coding loop patterns:

| Pattern | ThoughtCurrent Use |
|---------|-------------------|
| Fresh context per iteration | No context rot in long compilations |
| Specs as source of truth | Topic-scoped spec files drive agent work |
| Bidirectional planning | Phase 2 developer interview + follow-up Q&A |
| One task per iteration | Keep agents in the "smart zone" of context |
| Backpressure through tests | Compilation verified by item count + date coverage |

### Anthropic C Compiler

16-agent collaborative build:

| Pattern | ThoughtCurrent Use |
|---------|-------------------|
| Coordination through shared state (git/disk) | Shared output directory + task list |
| Task locking (filesystem) | Prevent duplicate work across agents |
| Agent self-orientation via READMEs | CLAUDE.md + per-source specs bootstrap each agent |
| Specialization after core | Generic compilers first, specialized research agents later |
| Oracle-based parallel testing | Validate compilation output against known-good API responses |

---

## 17. Resolved Decisions

- [x] **GUI framework** — Vite + React + shadcn/ui + Hono on Bun. No Next.js (SSR overhead unnecessary for local tool). No TUI (insufficient for card views, markdown rendering, Q&A chat).
- [x] **V1 output** — Purely local markdown files. No database for Phase 1.
- [x] **Large compilations** — Agent teams with context window monitoring. Respawn teammates at ~80% context usage with compacted output. Fresh context per respawn (Ralph pattern).
- [x] **Incremental compilation** — Yes. Cache tracks fetched items; skip already-local content on re-run.
- [x] **Microsoft Teams** — Deferred. Azure AD complexity too high for MVP.
- [x] **AI summaries** — Yes. Used for dashboard cards showing subtasks and PRDs. Stored in `.meta/summaries.json`.
- [x] **Export format** — Local markdown only. User manually creates GitHub issues from the GUI via explicit button clicks after review. No automatic export.
- [x] **WebSearch/WebFetch** — Yes for Phase 2 research agents. Malware protection via PreToolUse hooks.

## 18. Open Questions

- [ ] Agent team sizing: how many concurrent teammates before token cost becomes prohibitive?
- [ ] Should the constitution be user-editable per-compilation, or set once per project?
- [ ] Optimal context window respawn threshold — 80%? 70%? Needs testing.
- [ ] How to handle rate limits across sources when all compiler agents query simultaneously?
- [ ] Should the web dashboard run as a persistent local server or spin up on-demand?
