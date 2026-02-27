---
title: "feat: UI Dashboard and Bootstrap Wizard"
type: feat
status: completed
date: 2026-02-27
origin: docs/brainstorms/2026-02-27-ui-dashboard-brainstorm.md
---

# feat: UI Dashboard and Bootstrap Wizard

## Overview
Implement a browser-based UI for Tars using **Express, Vite, Preact, and Tailwind v4**. The UI will provide a seamless onboarding experience (Bootstrap Wizard) and a real-time management interface (Dashboard).

## Problem Statement / Motivation
Currently, Tars is configured via terminal scripts and `.env` files, which can be friction-heavy for new users. A web UI democratizes setup and provides a more accessible way to interact with the agent's chat history and settings.

## Proposed Solution
Introduce a dual-mode Express server:
1. **Setup Mode**: Active when `bootstrapped` setting is missing. Shows a wizard.
2. **Dashboard Mode**: Active when `bootstrapped` is present. Shows the chat mirror and settings.

The UI will be a Vite-powered single-page application (SPA) embedded within the Express project, utilizing the latest 2026 integration patterns (Vite Environment API).

## Technical Considerations
- **Backend**: Express on **Port 5827**. New entry point `src/server.ts`.
- **Frontend**: Preact + Tailwind v4 in `src/ui`.
- **Signal Integration**: Capture `signal-cli` link output and stream to UI via SSE.
- **Persistence**: Direct access to `tars.db` and Mastra memory.
- **Restart Logic**: Use `child_process.exec` to trigger `pnpm run daemon:restart` (Launchd integration).

## System-Wide Impact
- **Interaction Graph**: UI Dashboard -> Express API -> SQLite/Mastra Memory -> Signal Daemon.
- **Error Propagation**: Signal daemon errors surfaced via SSE to UI; API key validation errors returned via REST.
- **State Lifecycle**: `bootstrapped` timestamp in DB transition triggers mode switch.

## Acceptance Criteria
- [x] UI accessible at `http://localhost:5827`.
- [x] Bootstrap Wizard guides through API Keys, Persona, and Signal Linking.
- [x] Signal QR code displayed correctly during linking.
- [x] Chat Panel mirrors Signal messages in real-time using Mastra memory.
- [x] "System Restart" button successfully restarts the entire Tars stack.
- [x] Responsive design using Tailwind v4.

## Implementation Plan

### Phase 1: Foundation (Backend & Scaffolding)
- [x] Create `src/server.ts` with basic Express setup and Vite middleware.
- [x] Scaffold `src/ui` with Vite/Preact/Tailwind v4.
- [x] Implement `GET /api/status` to check `bootstrapped` state.

### Phase 2: Bootstrap Wizard
- [x] Implement `POST /api/config` to update `.env` and DB settings.
- [x] Implement `GET /api/signal/link` (SSE) to trigger `signal-cli --link` and stream QR code.
- [x] Build Wizard UI steps in Preact.

### Phase 3: Dashboard & Chat Mirror
- [x] Implement `GET /api/chat/history` using Mastra memory.
- [x] Implement SSE endpoint for real-time message updates.
- [x] Build Dashboard UI (Sidebar, Chat Panel, Settings).

### Phase 4: System Management
- [x] Implement `POST /api/system/restart`.
- [x] Finalize "bootstrapped" transition logic.

## MVP Mock Files
- `src/server.ts`: The Express API entry point.
- `src/ui/index.html`: Vite entry point.
- `src/ui/App.tsx`: Main Preact component with routing.
- `src/ui/styles/main.css`: Tailwind v4 entry point.

## Sources & References
- **Origin brainstorm:** [docs/brainstorms/2026-02-27-ui-dashboard-brainstorm.md](docs/brainstorms/2026-02-27-ui-dashboard-brainstorm.md)
- Express-Vite 2026 Integration: Vite 6+ Environment API documentation.
- Mastra Memory API: `src/mastra/index.ts`.
- Signal CLI: `src/signal.ts`.
