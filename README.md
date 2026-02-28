# Tars: Local-First AI Agent over Signal

Tars is a lean, secure, and privacy-focused AI agent that runs entirely on your local machine. It uses [Mastra](https://mastra.ai) for agent orchestration and communicates with you through your preferred Signal client.

## Key Features

- **Local-First**: Your conversation history, memory, and database stay on your hardware.
- **Signal Integration**: Interact with your agent anywhere via Signal.
- **Web Dashboard**: Modern UI for setup, configuration, and a "Chat Mirror" interface.
- **Dual-Interface Messaging**: Chat with Tars from your phone's Signal app or directly from the browser dashboard.
- **Mastra Powered**: Long-term memory, semantic recall, and a powerful tool system (Web search, File access, Shell execution).
- **Auto-Daemon**: Optional macOS `launchd` support to keep Tars running in the background.

---

## Prerequisites

- **Node.js**: v20 or later.
- **pnpm**: Fast, disk-efficient package manager.
- **signal-cli**: Required for Signal communication.
  - On macOS: `brew install signal-cli`
- **Google Gemini API Key**: (Optional but recommended) Get one at [aistudio.google.com](https://aistudio.google.com/).

---

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/tars.git
   cd tars
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Run the Setup Wizard**:
   ```bash
   pnpm run setup
   ```
   This interactive CLI will help you configure your API keys, Signal numbers, and optional background service setup.

---

## Getting Started

### 1. Start the Dashboard
The dashboard provides a visual wizard to link your Signal account and configure the agent.
```bash
pnpm run server
```
Visit `http://localhost:5827` to access the UI.

### 2. Link your Signal Account
In the dashboard, navigate to the **Signal Link** section. You will be presented with a QR code or a linking URI. Scan this with your phone's Signal app (`Settings > Linked Devices > +`) to authorize Tars to send and receive messages.

### 3. Start the Agent
Once configured and linked, start the main Signal listener:
```bash
pnpm run start
```

---

## The Dashboard Messaging Interface

Tars includes a full-featured web dashboard. Beyond configuration, the **Chat Mirror** allows you to:
- **Direct Messaging**: Send messages to Tars from your browser when your phone is out of reach.
- **Real-time Sync**: See incoming and outgoing Signal messages live.
- **Rich Rendering**: Full Markdown support for code blocks, tables, and formatted responses.
- **Shared Memory**: Tars maintains the same conversation context whether you are on your phone or the dashboard.

---

## Customizing Tars

You can modify the agent's identity and behavior by editing the files in the `agent/` directory:
- `IDENTITY.md`: Define who Tars is.
- `USER.md`: Information about you (the user) to help Tars be more helpful.
- `SOUL.md`: Deeper behavioral constraints and personality traits.
- `SYSTEM.md`: Core architectural instructions.

Changes to these files are automatically ingested into the agent's database on the next run or via `pnpm run clean`.

---

## Command Reference

| Command | Description |
| :--- | :--- |
| `pnpm run setup` | Interactive CLI configuration wizard. |
| `pnpm run server` | Starts the Web Dashboard and API server (`:5827`). |
| `pnpm run start` | Runs the compiled agent Signal listener. |
| `pnpm run build` | Compiles the TypeScript project to `dist/`. |
| `pnpm run dev` | Runs the agent in watch mode (Signal listener). |
| `pnpm run clean` | Wipes the local database and re-seeds from `agent/` templates. |
| `pnpm run daemon:start` | (macOS) Starts the Tars background service. |
| `pnpm run daemon:stop` | (macOS) Stops the Tars background service. |

---

## Architecture

- **Engine**: [Mastra](https://mastra.ai)
- **Model**: Google Gemini 2.0 Flash (Default)
- **Transport**: [signal-cli](https://github.com/AsamK/signal-cli) daemon via SSE/JSON-RPC
- **Database**: SQLite (better-sqlite3) with WAL mode
- **UI**: Preact + Vite + Tailwind CSS

---

## License

MIT © [David Golding](https://github.com/davidgolding)
