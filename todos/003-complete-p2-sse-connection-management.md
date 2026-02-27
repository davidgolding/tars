---
status: complete
priority: p2
issue_id: 003
tags: [performance, sse]
dependencies: []
---

# Problem Statement
The `/api/chat/events` Server-Sent Events (SSE) endpoint in `src/server.ts` does not implement connection heartbeats or concurrency limits. Over time, dropped client connections could lead to memory leaks in the `uiEvents` emitter.

# Findings
- `src/server.ts`: The SSE endpoint registers a listener on `uiEvents` but relies solely on the client closing the request to detach the listener. If a client drops ungracefully, the listener remains active indefinitely.

# Proposed Solutions

## Option 1: Implement SSE Heartbeat
- **Description:** Send a periodic comment (`:

`) every 30 seconds to keep the connection alive and detect dead sockets.
- **Pros:** Standard approach to SSE connection management.
- **Cons:** Adds slight complexity to the route.
- **Effort:** Small
- **Risk:** Low

# Technical Details
- File: `src/server.ts`
- Route: `GET /api/chat/events`

# Acceptance Criteria
- [ ] Server sends periodic heartbeat pings to SSE clients.
- [ ] Dead connections are correctly identified and `uiEvents` listeners are cleaned up.

# Work Log
- ${new Date().toISOString().split('T')[0]}: Finding created during initial UI review.

# Resources
- None.