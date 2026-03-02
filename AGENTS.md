# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## What This Is

Tars is a local-first AI agent with a plugin-based channel system. It uses Google Gemini (`@ai-sdk/google` + `LLM_API_KEY`) as the LLM backend and runs entirely on the local machine. The agent communicates via channel plugins (e.g., Signal, installed from the `tars-plugins` marketplace). The agent infrastructure is built on Mastra (agent, memory, tools).

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
| `src/index.ts`        | Main application entry point that wires up the database, Mastra agent, and channel plugins.                       |
| `src/events.ts`       | EventEmitter for UI message notifications (SSE).                                                                  |
| `src/plugins/`        | Plugin system: `channel-manager.ts` (loads/starts plugins), `marketplace.ts` (registry fetch/install), `types.ts`.|
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
Channel message → ChannelPlugin.onMessage() → channelManager → processAgentMessage() → tarsAgent.generate() → Mastra Agent → tool dispatch → plugin.send() → response
```

1. Channel plugins (e.g., Signal) receive messages and invoke the `messageHandler` callback wired by `ChannelManager`.
2. `src/mastra/service.ts` is the processing layer: `processAgentMessage()` handles typing indicators, agent generation, and response routing — all through the channel plugin interface.
3. `src/index.ts` initializes the DB, loads channel plugins via `channelManager.loadPlugins()`, and handles graceful shutdown.
4. `src/mastra/agents/tars.ts` defines the Tars agent. `buildSystemPrompt()` reads from the database and returns either the bootstrap prompt or the full persona prompt. The agent uses Mastra's native Memory for conversation history and semantic recall.
5. Markdown is stripped from responses (via `remove-markdown`) before being sent to the originating channel.

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
| `LLM_API_KEY` | — | Required. LLM API key. |
| `LLM_API_MODEL` | `google/gemini-flash-latest` | Provider/Model string to use. |
| `LLM_MAX_ITERATIONS` | `35` | Max agent loop steps per message. |
| `MCP_SERVER_COMMAND` | — | Optional STDIO MCP server to load tools from. |
| `AGENT_PROMPTS_PATH` | `agent/` | Directory to seed agent context from on first run. |
| `TARS_MARKETPLACE_URL` | GitHub raw URL | Plugin marketplace registry URL. |

## Important Notes

- `pnpm` is the package manager — do not use `npm` or `yarn`.
- TypeScript uses `NodeNext` module resolution; all local imports must include `.js` extensions.
- The database file is `tars.db` in the project root. `pnpm run clean` resets it completely.
- `src/mastra/` is the core agent subsystem. Load the `/mastra` skill before touching that code.
- The `dist/` and `.mastra/` directories are build artifacts and should not be edited directly.

## Handoff
Generated: 2026-03-01T17:11:00-07:00

### Spec Reference
The Tars project is a local-first AI agent using Mastra with a plugin-based channel architecture. Signal (and other messaging services) are installed as channel plugins from the `tars-plugins` marketplace. The core has no hardcoded messaging dependencies.

### Architecture Snapshot
- `src/mastra/agents/tars.ts`: Main agent definition, separated into `TarsAgent` and `BootstrapAgent`.
- `src/mastra/service.ts`: Channel-agnostic message processing — routes through `channelManager`.
- `src/plugins/channel-manager.ts`: Loads, starts, and manages channel plugins. Wires message handlers and setup routes.
- `src/plugins/marketplace.ts`: Fetches registry from `tars-plugins` repo, installs plugins via sparse checkout.
- `src/plugins/types.ts`: Plugin interfaces including `ChannelPlugin`, `sendTyping`, `getSetupRoutes`.
- `src/events.ts`: UI SSE event notifications.
- `src/server.ts`: Dashboard API — marketplace endpoints, plugin management, chat mirror.

### Current State
- **Working / complete:** Plugin system, marketplace infrastructure, Signal decoupled to plugin, service layer abstraction, wizard redesign with marketplace flow.
- **In progress:** None.
- **Blocked / known issues:** The `tars-plugins` GitHub repo needs to be created with `registry.json` and the Signal plugin files.

### Recent Changes
- Deleted `src/signal.ts` — all Signal functionality now lives in `public/.agents/plugins/signal/`.
- Renamed `src/signal_events.ts` → `src/events.ts`.
- Rewrote `src/mastra/service.ts` to route all communication through `channelManager` — no Signal imports.
- Rewrote `src/index.ts` — removed Signal requirements, uses `channelManager.loadPlugins()`.
- Rewrote `src/scheduler.ts` — broadcasts via `channelManager.getEnabledPlugins()`.
- Created `src/plugins/marketplace.ts` — `fetchRegistry()`, `installPlugin()`, `listAvailable()`.
- Updated `src/plugins/channel-manager.ts` — removed Signal hardcoding, added `mountPluginRoutes()`, wires global message handler automatically.
- Updated Signal plugin — uses `this.messageHandler` callback instead of direct import, added `sendTyping()` and `getSetupRoutes()`.
- Rewrote `src/ui/src/components/Wizard.tsx` — 3-step flow with marketplace plugin browser.
- Updated `src/ui/src/components/Dashboard.tsx` — channel-based status, marketplace browse in Channels tab.
- Updated `src/server.ts` — removed Signal endpoints, added marketplace endpoints, updated `/api/status`.

### Key Decisions & Context
- **Plugin Architecture:** All channel communication flows through `ChannelManager`. Plugins implement `ChannelPlugin` interface with `send()`, `onMessage()`, and optional `sendTyping()` / `getSetupRoutes()`.
- **Marketplace:** `tars-plugins` GitHub repo serves as the plugin registry. `registry.json` lists available plugins. Install uses git sparse checkout.
- **Bootstrapping Isolation:** `BootstrapAgent` intentionally omits the `memory` argument in `.generate()` to prevent creating traces until identity is fully bootstrapped.

### Dev Environment
- `pnpm` package manager
- `pnpm run dev:mastra` to start Dev Studio on `:4112`.
- `pnpm run build && pnpm run start` for daemon usage.
