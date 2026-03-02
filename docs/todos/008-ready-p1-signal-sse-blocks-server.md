---
status: ready
priority: p1
issue_id: "008"
tags: [bug, architecture, signal-plugin, server-startup]
dependencies: []
---

# Critical: Signal Plugin SSE Loop Blocks Server Startup

## Problem Statement

The Signal plugin's `start()` method calls `await this.startSSE()` which contains an infinite `while (true) { await reader.read() }` loop. When `channelManager.loadPlugins()` is called at `server.ts:716`, it awaits `startPlugin()` → `start()` → `startSSE()`, which never resolves. The HTTP server never starts, so the dashboard never loads.

Root cause of both reported symptoms:
1. Dashboard doesn't load → server never binds to port
2. Signal plugin stays in foreground → SSE reader loop blocks the event loop

## Findings

- Location: `public/.agents/plugins/signal/index.ts:206-296` and `src/server.ts:716-720`
- The `startSSE()` method has `while (true) { await reader.read() }` that never completes
- `channelManager.loadPlugins()` awaits plugin start, which awaits SSE — blocking `app.listen()`

## Proposed Solutions

### Option 1: Fire-and-forget SSE (Recommended)
- **Pros**: Minimal change, unblocks server startup immediately
- **Cons**: None significant
- **Effort**: Small (< 30 minutes)
- **Risk**: Low

## Recommended Action

Change `await this.startSSE(...)` to fire-and-forget with error handling.

## Technical Details
- **Affected Files**: `public/.agents/plugins/signal/index.ts`
- **Related Components**: channel-manager.ts, server.ts
- **Database Changes**: No

## Acceptance Criteria
- [ ] `pnpm run server` starts and dashboard loads
- [ ] Signal plugin connects to SSE in background
- [ ] Server binds to port before SSE loop starts

## Work Log

### 2026-03-01 - Approved for Work
**By:** Claude Triage System
**Actions:**
- Issue approved during triage session
- Status changed from pending → ready
- Ready to be picked up and worked on

**Learnings:**
- Blocking async loops in plugin start() prevent the entire server from starting

## Notes
Source: Triage session on 2026-03-01
