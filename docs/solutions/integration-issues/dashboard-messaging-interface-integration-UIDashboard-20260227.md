---
module: UI Dashboard
date: 2026-02-27
problem_type: integration_issue
component: assistant
symptoms:
  - "Dashboard Chat Mirror was read-only"
  - "Users could only interact with the agent via Signal app"
  - "Logic drift risk between UI and Signal interfaces"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [dashboard-messaging, shared-service, signal-sync, mastra]
---

# Troubleshooting: Enabling Dashboard Messaging via Shared Agent Service

## Problem
The Tars dashboard was limited to being a "Chat Mirror" only. Users who completed setup in the browser had to switch to their phone's Signal app to start messaging the agent. This created a friction-filled onboarding experience and lacked a contingency interface for when Signal is inaccessible.

## Environment
- Module: UI Dashboard / System
- Affected Component: Assistant / API Server
- Date: 2026-02-27

## Symptoms
- Chat input in the dashboard was disabled with a placeholder "Messaging not yet implemented".
- Agent processing logic was tightly coupled to the Signal SSE listener in `src/index.ts`, making it inaccessible to the API server in `src/server.ts`.
- No `POST` endpoint existed for sending messages from the UI.

## What Didn't Work

**Direct solution:** The problem was identified as a structural coupling issue. Instead of duplicating the `index.ts` logic into `server.ts`, a shared service was extracted to ensure parity and prevent logic drift.

## Solution

1. **Shared Service Extraction**: Created `src/mastra/service.ts` to encapsulate the agent's message processing flow (typing indicators, memory thread management, agent generation, and UI notifications).
2. **Backend API**: Implemented a `POST /api/chat/send` route in `src/server.ts` that validates input with Zod and triggers the shared service.
3. **Frontend Implementation**: Updated `Dashboard.tsx` to handle the chat input, sending state ("Thinking..."), and intelligent message parsing.
4. **Intelligent Parsing**: Added logic to extract text from Mastra's complex JSON message format (Version 2 with `parts` array) and handle fallback parsing for error objects. This prevents raw JSON from being displayed when loading history from the database.
5. **SSE Deduplication**: Implemented client-side deduplication using message IDs to prevent overlapping between historical messages and live SSE updates.
6. **Markdown Support**: Integrated `react-markdown` and `remark-gfm` in the dashboard to render rich text, code blocks, and tables, ensuring the UI provides a modern chat experience.

**Code changes**:

`src/mastra/service.ts` (New shared service):
```typescript
export async function processAgentMessage({ text, sender, groupId, origin = 'signal' }) {
  const threadId = getThreadId(sender, groupId);
  try {
    await sendSignalTyping(..., true); // Sync typing to Signal
    notifyUIMessage({ role: 'user', content: text, threadId });
    const result = await tarsAgent.generate(text, { memory: { thread: threadId } });
    notifyUIMessage({ role: 'assistant', content: result.text, threadId });
  } finally {
    await sendSignalTyping(..., false);
  }
}
```

`src/server.ts` (API Endpoint):
```typescript
const chatSchema = z.object({ content: z.string().min(1).max(2000) });
apiRouter.post('/chat/send', async (req, res) => {
    const { content } = chatSchema.parse(req.body);
    processAgentMessage({ text: content, sender: targetNumber, origin: 'ui' });
    res.json({ success: true });
});
```

## Why This Works

1. **Decoupling**: By extracting the agent logic into a standalone service, both the Signal listener and the Dashboard API can trigger the same "brain" without duplicating code.
2. **Asynchronous UI Updates**: The API returns a `200 OK` immediately after starting the background process. The actual agent response and intermediate state changes (user message appearance) are handled via the existing Server-Sent Events (SSE) stream, providing a reactive and consistent UI.
3. **Cross-Channel Parity**: Triggering `sendSignalTyping` even for dashboard messages ensures that if a user has their phone open, they see the agent is "thinking" regardless of which interface they are using.

## Prevention

- **Extract Shared Logic**: Always move core business or agentic logic out of entry-point files (`index.ts`, `server.ts`) and into shared services.
- **Input Validation**: Use Zod for all API inputs to prevent malformed data from reaching the agent.
- **SSE Deduplication**: When mirroring state via SSE, ensure the frontend checks for unique message IDs to prevent duplicates from overlapping history loads and live pushes.

## Related Issues

- **Plan**: [docs/plans/2026-02-27-feat-dashboard-messaging-interface-plan.md](../../plans/2026-02-27-feat-dashboard-messaging-interface-plan.md)
- **Brainstorm**: [docs/brainstorms/2026-02-27-dashboard-messaging-sync-brainstorm.md](../../brainstorms/2026-02-27-dashboard-messaging-sync-brainstorm.md)
