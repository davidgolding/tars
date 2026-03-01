---
status: pending
priority: p2
issue_id: "006"
tags: [memory-leak, plugin-system, resources]
dependencies: []
---

# High: Potential Memory Leak - Message Handlers Not Properly Replaced

## Problem Statement

When `registerMessageHandler` is called multiple times, old handlers may not be properly cleaned up, potentially causing memory leaks or stale handler references.

## Findings

**Evidence from TypeScript review:**

```typescript
// src/plugins/channel-manager.ts:157-164
registerMessageHandler(pluginId: string, handler: MessageHandler): void {
  this.messageHandlers.set(pluginId, handler);  // Overwrites but old handler may still be referenced
  
  const loaded = this.plugins.get(pluginId);
  if (loaded) {
    loaded.instance.onMessage(handler);  // Each call adds new handler
  }
}
```

If the plugin's `onMessage` method uses event listeners or subscriptions, calling `registerMessageHandler` multiple times could accumulate handlers without cleanup.

## Proposed Solutions

### Option 1: Track and Cleanup Handlers

**Approach:** Store the old handler and call cleanup before setting new one.

```typescript
registerMessageHandler(pluginId: string, handler: MessageHandler): void {
  // Cleanup old handler if exists
  const existingHandler = this.messageHandlers.get(pluginId);
  if (existingHandler) {
    const loaded = this.plugins.get(pluginId);
    if (loaded?.instance.cleanupHandler) {
      loaded.instance.cleanupHandler(existingHandler);
    }
  }
  
  this.messageHandlers.set(pluginId, handler);
  
  const loaded = this.plugins.get(pluginId);
  if (loaded) {
    loaded.instance.onMessage(handler);
  }
}
```

**Pros:**
- Prevents handler accumulation
- Clean pattern

**Effort:** 2 hours

**Risk:** Low

---

### Option 2: Remove Handler Registration Entirely (Simpler)

**Approach:** Only register handler once during plugin initialization, not dynamically.

```typescript
// In loadPluginFromDirectory
if (dbPlugin && dbPlugin.enabled) {
  await this.startPlugin(manifest.id);
  // Register handler once during start
  const loaded = this.plugins.get(manifest.id);
  if (loaded) {
    loaded.instance.onMessage(this.createMessageHandler(manifest.id));
  }
}
```

**Pros:**
- Simpler implementation
- No dynamic handler changes needed

**Effort:** 1 hour

**Risk:** Low

---

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/plugins/channel-manager.ts:157-164`

## Acceptance Criteria

- [ ] No handler accumulation on repeated calls
- [ ] Memory usage stable over time

## Work Log

### 2026-03-01 - Initial Discovery

**By:** TypeScript Review

**Actions:**
- Identified potential handler leak pattern
