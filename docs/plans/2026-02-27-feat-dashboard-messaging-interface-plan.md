---
title: "feat: Dashboard Messaging Interface (Dual-Interface Agent)"
type: feat
status: completed
date: 2026-02-27
origin: docs/brainstorms/2026-02-27-dashboard-messaging-sync-brainstorm.md
---

# feat: Dashboard Messaging Interface (Dual-Interface Agent)

## Overview
This feature adds a messaging interface to the Tars dashboard, allowing users to interact with the agent directly from their browser. While Signal remains the primary communication channel, the dashboard serves as a first-class alternative with shared memory and agent logic.

## Problem Statement / Motivation
Currently, the dashboard is a "Chat Mirror" only. Users who complete the setup routine in the dashboard have to switch to Signal to start interacting. Providing a direct messaging interface in the dashboard improves the onboarding experience and provides a contingency when Signal is inaccessible.

## Proposed Solution
1. **Shared Service Extraction**: Extract the agent processing logic (generate, notify, typing indicators) from `src/index.ts` into a shared utility/service. This ensures consistency between Signal and Dashboard interfaces.
2. **Backend API**: Implement a `POST /api/chat/send` endpoint in `src/server.ts` that uses this shared service.
3. **Frontend Implementation**: Enable the message input and send button in `Dashboard.tsx`, adding loading states and integrating with the existing SSE event stream.

## Technical Considerations
- **Shared Logic**: Extracting logic to `src/mastra/service.ts` (or similar) to prevent drift.
- **Input Validation**: Use `zod` to validate the `/api/chat/send` request body (string type, max length).
- **Typing Indicators**: The shared service will trigger `sendSignalTyping` for both interfaces.
- **SSE Integration**: Dashboard messages and agent responses will be pushed via `uiEvents`.

## System-Wide Impact

### Interaction Graph
- `Dashboard UI` (POST /api/chat/send) -> `server.ts` (/api/chat/send)
- `server.ts` -> `AgentService.processMessage()` (Shared logic)
- `AgentService` -> `tarsAgent.generate()` (Mastra)
- `AgentService` -> `sendSignalTyping(true)` (Signal Daemon)
- `AgentService` -> `uiEvents.emit('message')` (SSE -> Dashboard UI)
- `AgentService` -> `sendSignalTyping(false)` (Signal Daemon)

### Error & Failure Propagation
- **Validation Errors**: 400 Bad Request if input is invalid.
- **Agent Failures**: 500 Internal Server Error. The UI must catch these and re-enable the input/button while showing an error message.
- **Signal Daemon Offline**: The `sendSignalTyping` calls should fail gracefully without crashing the message processing.

### State Lifecycle Risks
- **Shared Thread ID**: Centralize `threadId` generation to ensure dashboard and Signal messages consistently map to the same memory context.

### API Surface Parity
- The dashboard interface preserves markdown, whereas Signal-bound messages (if any in the future) would be stripped.

## Acceptance Criteria

- [x] User can type a message in the Dashboard "Chat Mirror" and click "Send".
- [x] Input and Send button are disabled while the agent is processing.
- [x] A "Thinking..." state or loading spinner is visible during processing.
- [x] Dashboard message appears immediately in the chat window.
- [x] Signal app (authorized user) shows a typing indicator while the dashboard agent is thinking.
- [x] Agent response appears in the Dashboard chat window via SSE.
- [x] Agent maintains context from previous Signal conversations.
- [x] Backend validates input length and type using Zod.

## MVP Implementation Plan

### src/mastra/service.ts (New)
Extract shared logic:
```typescript
export async function processAgentMessage(content: string, threadId: string) {
  // 1. sendSignalTyping(true)
  // 2. notifyUIMessage(user)
  // 3. result = await tarsAgent.generate(...)
  // 4. notifyUIMessage(assistant)
  // 5. sendSignalTyping(false)
}
```

### src/server.ts
Add validated route:
```typescript
const chatSchema = z.object({ content: z.string().min(1).max(2000) });
apiRouter.post('/chat/send', async (req, res) => {
  const { content } = chatSchema.parse(req.body);
  // Call shared service...
});
```

### src/ui/src/components/Dashboard.tsx
Enable input with `isSending` state:
```typescript
const [isSending, setIsSending] = useState(false);
const handleSendMessage = async () => {
  setIsSending(true);
  try { /* fetch POST */ }
  finally { setIsSending(false); }
};
```

## Sources & References
- **Origin brainstorm:** [docs/brainstorms/2026-02-27-dashboard-messaging-sync-brainstorm.md](docs/brainstorms/2026-02-27-dashboard-messaging-sync-brainstorm.md)
- Similar implementation (Signal incoming): `src/index.ts`
- SSE Event system: `src/signal_events.ts`
