---
date: 2026-02-27
topic: ui-dashboard
---

# UI Dashboard and Bootstrap Wizard

## What We're Building
A user-friendly, browser-based dashboard for Tars that runs on localhost. The UI serves two primary purposes:
1. **Bootstrap Wizard**: A "Day 0" setup routine for unconfigured instances, guiding users through API key configuration, Signal account linking (via QR code), and initial agent persona setup.
2. **Management Dashboard**: A "Day 1+" interface providing a real-time chat mirror of the Signal group/DM, system health monitoring, and configuration management (settings/persona updates).

## Why This Approach
- **Express + Vite/Preact**: Provides a lightweight, fast, and modern development experience. Preact keeps the bundle size small, while Tailwind v4 ensures a cutting-edge, performant styling layer.
- **Separate Entry Point (`src/server.ts`)**: Decouples the UI/API from the core Signal listener/Agent loop, allowing the dashboard to remain accessible even if the Signal daemon is restarting or failing.
- **Integrated Storage**: Leverages existing Mastra memory and SQLite storage for message history and configuration, ensuring data consistency across the CLI and UI.

## Key Decisions
- **Tech Stack**: Vite, Preact, Tailwind v4 on the frontend; Express on the backend.
- **Port Choice**: **Port 5827** (mapped to "TARS" on a keypad) to minimize localhost port conflicts.
- **Location**: Frontend code resides in `src/ui` to keep the project structure cohesive.
- **Branching Strategy**: 
    - `dev`: Primary development branch.
    - `main`: Distributable package (un-bootstrapped UI by default).
    - `personal`: User-specific bootstrapped configuration and testing.
- **Real-time Communication**: Use WebSockets or SSE for streaming incoming Signal messages to the UI.
- **Security**: Localhost-only access without password authentication (simple port-based security).
- **Restart Logic**: The UI/API will be capable of triggering a full system restart.
- **Account Model**: Stick to a single-bot model as defined in `.env`.

## Open Questions
- None. (Resolved: UI handles full system restarts; Single-bot model only).

## Next Steps
→ `/workflows:plan` for implementation details once the open questions are clarified.
