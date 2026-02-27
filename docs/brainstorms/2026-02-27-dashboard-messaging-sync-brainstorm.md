---
date: 2026-02-27
topic: dashboard-messaging-interface
---

# Dashboard Messaging Interface (Dual-Interface Agent)

## What We're Building
A messaging interface within the Tars dashboard that allows users to interact with the agent as if they were on Signal. This serves as a first-class alternative interface for cases where the Signal app is inaccessible or when the user has just completed setup and wants to interact immediately.

## Why This Approach
The "Dual-Interface" approach allows for a seamless transition between Signal and the Dashboard. While messages are not mirrored across networks (to keep histories clean), the agent's underlying memory and state are shared, making it feel like the same agent regardless of where you message it.

## Key Decisions
- **Local-Only Messaging:** Messages sent from the dashboard, and the agent's responses to them, will remain local to the dashboard and will not be mirrored to the Signal app. This avoids cluttered Signal history where the bot would appear to be talking to itself.
- **Shared Memory:** Use the same `threadId` (`signal:dm:<number>` or `signal:group:<id>`) for dashboard messages so the agent maintains full context across both Signal and Dashboard interfaces.
- **Dual Typing Indicators:** When processing a dashboard message, the agent will trigger a typing indicator in both the Dashboard UI and the Signal app. This provides feedback to the user on all connected interfaces that the agent is active.
- **Unified Logic:** The backend will use a shared processing service to ensure agent behavior, tools, and response formatting are identical across both interfaces.

## Resolved Questions
- **Prefixing:** No prefixing is needed as messages are not mirrored to Signal.
- **Identity:** Since messages aren't mirrored, we avoid the confusion of the bot appearing to send the user's messages.
- **Visibility:** Bot replies to dashboard messages are dashboard-only. Bot replies to Signal messages are Signal-only (but mirrored in the dashboard's "Chat Mirror" view).

## Next Steps
→ `/workflows:plan` for implementation details including:
- Creating the `POST /api/chat/send` endpoint in `server.ts`.
- Implementing the typing indicator logic for both Signal and Dashboard.
- Enabling the message input and send button in `Dashboard.tsx`.
