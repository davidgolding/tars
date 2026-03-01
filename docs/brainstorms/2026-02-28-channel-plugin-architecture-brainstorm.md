---
date: 2026-02-28
topic: channel-plugin-architecture
---

# Channel Plugin Architecture

## What We're Building

A plugin-based architecture that abstracts Signal (and future channels) as plugins within Tars. The system has:

- **Plugins**: Parent concept for any extendable component
- **Channels**: A plugin type for communication adapters (Signal, WhatsApp, Discord, etc.)
- **Dashboard UI**: "Channels" sidebar item next to "Skills" to manage channel plugins
- **Plugin installation**: From GitHub repos into `public/.agents/plugins/`

## Why This Approach

We chose **Plugin Interface with Dynamic Loader** (Approach A) because:
- Clean separation via interfaces
- Extensible - any code following the interface works
- Matches existing skills pattern (`public/.agents/skills/`)
- Allows future non-channel plugins

### Alternatives Considered

- **Approach B (Adapter/Registry)**: More complex coupling, harder to standardize
- **Approach C (Simple Router)**: Not truly plugin-based, doesn't support GitHub repo installation

## Key Decisions

### 1. Plugin Interface Structure

```
public/.agents/plugins/
├── signal/           # Each plugin is a folder
│   ├── index.ts      # Implements Plugin interface
│   ├── schema.json   # Config fields for UI forms
│   └── package.json  # Dependencies
├── discord/
│   └── ...
```

**Plugin Interface:**
```typescript
interface Plugin {
  id: string;
  name: string;
  type: 'channel' | 'adapter' | 'future';
  version: string;
  
  // Lifecycle
  init(config: PluginConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): PluginStatus;
}

interface ChannelPlugin extends Plugin {
  type: 'channel';
  
  // Send/Receive
  send(recipient: string, message: string): Promise<void>;
  onMessage(handler: MessageHandler): void;
  
  // Channel-specific
  getChannelId(): string;
}
```

### 2. Configuration via Dashboard UI Forms

- Each plugin defines `schema.json` with required fields
- Dashboard renders forms based on schema
- Config stored in DB (`plugin_config` table)
- Environment variable interpolation support (`{{env:VAR_NAME}}`)

### 3. Migrate Signal to Plugin

Current `src/signal.ts` becomes `public/.agents/plugins/signal/index.ts`:
- Implements `ChannelPlugin` interface
- Same `signal-cli` daemon logic
- Config: bot number, target number, target group, port

### 4. Message Routing

- Agent responds on the channel where message originated
- `processAgentMessage` receives `channelId` instead of hardcoded `'signal'`
- `ChannelManager` routes messages to correct plugin handler

### 5. UI Integration

- New "Channels" sidebar tab (next to "Skills")
- Lists installed channel plugins with status (online/offline)
- Install via GitHub URL (like skills)
- Configuration form per channel
- Toggle enable/disable

### 6. Plugin Installation Flow

1. User pastes GitHub URL in Channels panel
2. Server clones repo to `public/.agents/plugins/{plugin-id}/`
3. Runs `npm install` if `package.json` exists
4. Loads plugin, prompts for config based on schema
5. On enable: calls `plugin.start()`

## Open Questions

- **Plugin dependency management**: Should plugins declare dependencies? How to handle version conflicts?
- **Plugin isolation**: Should plugins run in sandboxed processes for security?
- **Plugin update mechanism**: How to handle plugin updates from remote repos?
- **Fallback channel**: If primary channel fails, should responses route to backup?

## Next Steps

→ `/workflows:plan` for implementation details
