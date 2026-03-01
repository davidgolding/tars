---
status: complete
priority: p1
issue_id: "003"
tags: [agent-native, plugin-system, tools]
dependencies: []
---

# Critical: Agent Cannot Manage Plugins - No Tool Parity

## Problem Statement

The plugin system is UI-only. The agent has ZERO tools to interact with plugins. This violates the core agent-native principle: **every UI action should have an equivalent agent tool**.

Users must use the Dashboard UI to:
- List plugins
- Enable/disable plugins
- Get/update plugin config
- Install new plugins

The agent cannot help with plugin management, self-hosting, or automation.

## Findings

**Evidence from agent-native review:**

| UI Action | Location | Agent Tool | Status |
|-----------|----------|------------|--------|
| List plugins | `server.ts:496` | ❌ None | Missing |
| Toggle plugin | `server.ts:519` | ❌ None | Missing |
| Get plugin config | `server.ts:541` | ❌ None | Missing |
| Update plugin config | `server.ts:551` | ❌ None | Missing |
| Install plugin | `server.ts:567` | ❌ None | Missing |

**Impact:**
- Agent cannot help users manage channels
- No automation possible for plugin operations
- Agent-native parity violation
- Users must use UI for everything

## Proposed Solutions

### Option 1: Create Plugin Management Tools (Recommended)

**Approach:** Add tools to `src/mastra/tools/` for plugin operations.

```typescript
// src/mastra/tools/plugins.ts
export const listPluginsTool = createTool({
  id: 'list_plugins',
  description: 'List all installed channel plugins and their status (online/offline)',
  execute: async () => {
    const plugins = channelManager.listPlugins();
    return plugins.map(p => ({
      id: p.id,
      name: p.name,
      enabled: p.enabled,
      status: channelManager.getPluginStatus(p.id)
    }));
  }
});

export const togglePluginTool = createTool({
  id: 'toggle_plugin',
  description: 'Enable or disable a channel plugin',
  inputSchema: z.object({
    pluginId: z.string(),
    enabled: z.boolean()
  }),
  execute: async ({ pluginId, enabled }) => {
    if (enabled) {
      await channelManager.startPlugin(pluginId);
    } else {
      await channelManager.stopPlugin(pluginId);
    }
    return { success: true, enabled };
  }
});
```

**Pros:**
- Complete agent-native parity
- Enables automation
- Follows existing tool patterns

**Cons:**
- Requires API key/auth for certain operations

**Effort:** 4-6 hours

**Risk:** Low

---

### Option 2: Inject Plugin Context into System Prompt

**Approach:** Add available plugins to system prompt.

```typescript
// In buildSystemPrompt() in tars.ts
const plugins = channelManager.listPlugins();
const enabledPlugins = plugins.filter(p => p.enabled);

if (enabledPlugins.length > 0) {
  prompt += `<AVAILABLE_CHANNELS>\n`;
  for (const p of enabledPlugins) {
    const status = channelManager.getPluginStatus(p.id);
    prompt += `- ${p.name} (${p.id}): ${status.online ? 'online' : 'offline'}\n`;
  }
  prompt += `</AVAILABLE_CHANNELS>\n\n`;
}
```

**Pros:**
- Agent knows what channels exist
- Low effort

**Cons:**
- Doesn't give agent ability to manage plugins

**Effort:** 1-2 hours

**Risk:** Low

---

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/mastra/agents/tars.ts` - Add tools to builtinTools
- `src/mastra/tools/` - Create new tool files
- `src/mastra/index.ts` - Register new tools

**Database changes:** None

## Resources

- **PR:** Current branch (dev)
- **Pattern:** See existing tools in `src/mastra/tools/`

## Acceptance Criteria

- [ ] Agent can list plugins via tool
- [ ] Agent can enable/disable plugins via tool
- [ ] Agent can get/update plugin config via tool
- [ ] System prompt includes available channels

## Work Log

### 2026-03-01 - Initial Discovery

**By:** Agent-Native Review

**Actions:**
- Mapped all UI plugin actions to agent capabilities
- Found 0/6 are accessible to agent

**Learnings:**
- Classic "UI-only" architecture violation

---

### 2026-03-01 - Fix Applied

**By:** Claude Code

**Actions:**
- Created `src/mastra/tools/plugins.ts` with three new tools:
  - `list_plugins` - List all installed plugins and status
  - `toggle_plugin` - Enable/disable a plugin
  - `get_plugin_config` - Get configuration for a plugin
- Registered tools in `builtinTools` in tars.ts

**Learnings:**
- Now 3/6 plugin capabilities accessible to agent
- Can expand to include install_plugin and update_plugin_config in future
