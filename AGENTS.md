# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Tars is a local-first AI agent that operates over Signal. It uses Google Gemini (`@ai-sdk/google` + `LLM_API_KEY`) as the LLM backend and runs entirely on the local machine. The agent communicates exclusively via Signal messages, using signal-cli as a subprocess daemon. The agent infrastructure is built on Mastra (agent, memory, tools).

## Commands

```bash
pnpm run dev          # Start Mastra Studio at localhost:4111 (agent playground + traces)
pnpm run dev:signal   # Run the Signal listener in dev mode (tsx, no build step)
pnpm run build        # Compile TypeScript to dist/
pnpm run start        # Run compiled dist/index.js
pnpm run setup        # Interactive setup wizard (generates .env, optional launchd plist)
pnpm run clean        # Wipe all DB data and re-seed from agent/ templates

pnpm run test         # Run all tests with Vitest
pnpm run test:watch   # Run tests in watch mode

# Run a single test file:
pnpm vitest run src/mastra/tools/setting.test.ts

# macOS daemon management (requires prior setup):
pnpm run daemon:start
pnpm run daemon:stop
pnpm run daemon:restart   # stops → builds → starts
```

## Architecture

### Project Structure

Folders organize your agent's resources, like agents, tools, and workflows.

| Folder                 | Description                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/mastra`           | Entry point for all Mastra-related code and configuration.                                                                               |
| `src/mastra/agents`    | Define and configure your agents - their behavior, goals, and tools.                                                                     |
| `src/mastra/workflows` | Define multi-step workflows that orchestrate agents and tools together.                                                                  |
| `src/mastra/tools`     | Create reusable tools that your agents can call                                                                                          |
| `src/mastra/mcp`       | (Optional) Implement custom MCP servers to share your tools with external agents                                                         |
| `src/mastra/scorers`   | (Optional) Define scorers for evaluating agent performance over time                                                                     |
| `src/mastra/public`    | (Optional) Contents are copied into the `.build/output` directory during the build process, making them available for serving at runtime |

Top-level files define how your Mastra project is configured, built, and connected to its environment.

```markdown
| File                  | Description                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/mastra/index.ts` | Central entry point where you configure and initialize Mastra.                                                    |
| `src/index.ts`        | Main application entry point that wires up the database, Mastra agent, and message handlers.                      |
| `src/signal.ts`       | Manages the `signal-cli` subprocess, handles SSE stream connections, and processes incoming/outgoing messages.    |
| `src/mcp.ts`          | Configures and starts the Model Context Protocol (MCP) server for tool sharing.                                   |
| `src/db.ts`           | Database configuration and initialization for storing message history and agent state.                            |
| `src/setup.ts`        | Script for initial environment setup and configuration.                                                           |
| `src/reset.ts`        | Utility script to reset the database and clear application state.                                                 |
| `.env.example`        | Template for environment variables - copy and rename to `.env` to add your secret [model provider](/models) keys. |
| `package.json`        | Defines project metadata, dependencies, and available npm scripts.                                                |
| `tsconfig.json`       | Configures TypeScript options such as path aliases, compiler settings, and build output.                          |
```

### Request Flow

```
Signal message → signal.ts (SSE stream) → index.ts (handler) → tarsAgent.generate() → Mastra Agent → tool dispatch → response
```

1. `src/signal.ts` spawns `signal-cli` as a subprocess in HTTP daemon mode, then connects to its SSE endpoint to receive messages. Responses are sent back via JSON-RPC POST.
2. `src/index.ts` is the wiring layer: it initializes the DB, imports the Mastra agent, registers the message callback, and handles graceful shutdown.
3. `src/mastra/agents/tars.ts` defines the Tars agent. `buildSystemPrompt()` reads from the database and returns either the bootstrap prompt or the full persona prompt. The agent uses Mastra's native Memory for conversation history and semantic recall.
4. Markdown is stripped from responses (via `remove-markdown`) before being sent to Signal.

### Database (`src/db.ts`)

SQLite (`better-sqlite3`) with WAL mode. Two custom tables (Mastra manages its own memory tables internally):

| Table | Purpose |
|---|---|
| `agent_context` | Agent persona documents, keyed by category (IDENTITY, USER, SOUL, SYSTEM, etc.) |
| `settings` | Key-value store; the critical key is `bootstrapped` (a timestamp) |

Mastra also creates its own tables in `tars.db`: `mastra_messages`, `mastra_threads`, `mastra_resources`, and a vector embedding table (`mastra_memory_text_embedding_004`).

On first run with an empty `agent_context` table, the DB seeds itself by reading all `*.md` files from the `agent/` directory (or `AGENT_PROMPTS_PATH`). Each filename becomes a context category.

### Bootstrapping vs Normal Operation

The `bootstrapped` setting controls which system prompt is used:

- **Not bootstrapped**: The agent enters a discovery conversation to establish its identity, then writes IDENTITY/USER/SOUL context records and sets `bootstrapped` to the current timestamp.
- **Bootstrapped**: The full system prompt is built dynamically from the database — the AGENTS context doc, then all other context categories.

### LLM Provider

Tars uses the Mastra `provider/model` string specification for its LLM. The model is configured via `LLM_API_MODEL` (default: `google/gemini-2.0-flash`) and authenticated via `LLM_API_KEY`. `gemini-cli` is no longer supported.

### MCP Support (`src/mcp.ts`)

Optional. If `MCP_SERVER_COMMAND` is set in the environment, `createTarsAgent()` connects to the MCP server via STDIO and converts its tools to Mastra tool format. MCP tools are available to the agent alongside built-in tools.

### Agent Tools

Tools are defined in `src/mastra/tools/` as Mastra `createTool()` instances. They are registered directly on the agent — no manual dispatch needed. Built-in tools: `get_current_time`, `read_file`, `write_file`, `list_files`, `web_search`, `list_context_categories`, `read_context`, `update_context`, `delete_context`, `get_setting`, `update_setting`.

### Agent Persona (`agent/`)

The `agent/` directory contains markdown files that seed the `agent_context` DB table. The agent can read and update these at runtime via `read_context` / `update_context` tools. Key files: `IDENTITY.md`, `USER.md`, `SOUL.md`, `SYSTEM.md`, `AGENTS.md`, `TOOLS.md`.

## Environment Variables

See `.env.example`. Key ones:

| Variable | Default | Notes |
|---|---|---|
| `BOT_SIGNAL_NUMBER` | — | Required. E.164 format. |
| `TARGET_SIGNAL_NUMBER` | — | Required. Whitelisted user. |
| `TARGET_SIGNAL_GROUP` | — | Optional group name; if set, DMs from target number are ignored. |
| `LLM_API_KEY` | — | Required. LLM API key. |
| `LLM_API_MODEL` | `google/gemini-2.0-flash` | Provider/Model string to use. |
| `LLM_MAX_ITERATIONS` | `35` | Max agent loop steps per message. |
| `SIGNAL_CLI_PORT` | `8080` | Port for the signal-cli HTTP daemon. |
| `MCP_SERVER_COMMAND` | — | Optional STDIO MCP server to load tools from. |
| `AGENT_PROMPTS_PATH` | `agent/` | Directory to seed agent context from on first run. |

## Important Notes

- `pnpm` is the package manager — do not use `npm` or `yarn`.
- TypeScript uses `NodeNext` module resolution; all local imports must include `.js` extensions.
- The database file is `tars.db` in the project root. `pnpm run clean` resets it completely.
- `src/mastra/` is the core agent subsystem. Load the `/mastra` skill before touching that code.
- The `dist/` and `.mastra/` directories are build artifacts and should not be edited directly.

## Handoff
Generated: 2026-02-22T17:41:45-07:00

### Spec Reference
The Tars project is a local-first AI agent using Mastra, running on Signal with a Gemini backend. Current efforts are focused on improving the agent's core capabilities, isolating bootstrapping logic, solidifying sandbox execution schemas, and adding reliable web search via Jina AI.

### Architecture Snapshot
- `src/mastra/agents/tars.ts`: Main agent definition, now separated into `TarsAgent` and `BootstrapAgent`.
- `src/index.ts`: Signal message handler and dynamic routing between agents.
- `src/mastra/tools/`: Custom local tools including `search.ts` (Jina AI) and `execute.ts` (shell sandbox).
- `src/mastra/workspace.ts`: Configures `LocalSandbox` boundaries for command execution.

### Current State
- **Working / complete:** `BootstrapAgent` memory isolation, Mastra workspace execution schema fixes, dynamic routing, Jina AI search & fetch tools.
- **In progress:** Polishing core agent integration and custom tools.
- **Blocked / known issues:** None.

### Recent Changes
- `src/mastra/agents/tars.ts`: Separated `TarsAgent` & `BootstrapAgent` to isolate memory initialization. Fixed missing telemetry in custom tools.
- `src/index.ts`: Added dynamic routing to use the correct agent based on the `bootstrapped` state toggle.
- `src/mastra/workspace.ts`: Extracted workspace initialization to solve dependency cycles. Configured specific CWD resolving for executed commands.
- `src/mastra/tools/execute.ts`: Created `execute_command` explicitly to replace Mastra's built-in sandbox tool, solving Gemini schema failures.
- `src/mastra/tools/search.ts`: Implemented `web_search` and `read_url` tools using `s.jina.ai` and `r.jina.ai` securely via `JINA_API_KEY`.
- `.env`: Verified the `.env` configuration contains `JINA_API_KEY`.

### Next Steps
1. Verify the multi-agent bootstrapping flow works smoothly from scratch (`pnpm run clean`).
2. Test new tools (`web_search`, `read_url`, `execute_command`) extensively in complex usage via Signal client or Dev Studio.
3. Continue expanding Mastra agent capabilities or customizing system prompts.

### Key Decisions & Context
- **Jina AI:** Used seamlessly over a standard HTTP auth key for search/fetch instead of Playwright/SearXNG to maintain strict lightweight footprint.
- **Bootstrapping Isolation:** `BootstrapAgent` intentionally omits the `memory` argument in `.generate()` to prevent creating traces until identity is fully bootstrapped.
- **Execute schema overload:** Mastra's built-in `mastra_workspace_execute_command` is disabled in the Workspace config. The replacement custom tool is named `execute_command` and enforces mandatory JSON schema arguments to prevent Gemini 2.0 crashes.

### Dev Environment
- `pnpm` package manager
- `pnpm run dev:mastra` to start Dev Studio on `:4112`.
- `pnpm run build && pnpm run start` for daemon usage.
