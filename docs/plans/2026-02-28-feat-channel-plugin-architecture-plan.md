---
title: feat: Implement Channel Plugin Architecture
type: feat
status: active
date: 2026-02-28
origin: docs/brainstorms/2026-02-28-channel-plugin-architecture-brainstorm.md
---

# feat: Implement Channel Plugin Architecture

## Overview

Transform Signal from a hardcoded integration into a plugin-based architecture where any communication channel (Signal, WhatsApp, Discord, Telegram) can be added as a plugin. This enables Tars to receive messages from multiple sources and respond on the channel where the message originated.

## Problem Statement / Motivation

Currently, Signal is tightly coupled in `src/signal.ts` with hardcoded message handling. To support additional channels:
- Need clean abstraction for channel adapters
- Want plugin discoverability and installability from GitHub
- Require unified message routing (reply-to-source)
- Need configuration management via Dashboard UI

## Proposed Solution

Create a plugin system where:
1. **Plugin Interface** (`src/plugins/types.ts`) defines lifecycle and channel contract
2. **ChannelManager** (`src/plugins/channel-manager.ts`) loads and manages plugins
3. **Signal Plugin** (`public/.agents/plugins/signal/`) implements the interface
4. **Dashboard UI** adds Channels tab for plugin management
5. **Message Router** routes responses to the originating channel

## Technical Approach

### Architecture

```
src/
├── plugins/
│   ├── types.ts          # Plugin, ChannelPlugin interfaces
│   ├── channel-manager.ts # Plugin lifecycle management
│   ├── loader.ts         # Dynamic plugin loading
│   └── config.ts         # Config interpolation
├── index.ts              # Wire channel manager
├── server.ts             # Add /api/plugins endpoints
└── mastra/service.ts    # Update routing

public/.agents/plugins/
├── signal/
│   ├── index.ts          # ChannelPlugin implementation
│   ├── schema.json       # Config fields
│   └── package.json      # Dependencies
```

### Plugin Interface

```typescript
// src/plugins/types.ts
export interface Plugin {
  id: string;
  name: string;
  type: 'channel' | 'adapter';
  version: string;
  init(config: PluginConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): PluginStatus;
}

export interface ChannelPlugin extends Plugin {
  type: 'channel';
  send(recipient: string, message: string): Promise<void>;
  onMessage(handler: MessageHandler): void;
  getChannelId(): string;
}

export interface MessagePayload {
  text: string;
  sender: string;
  channelId: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface PluginConfig {
  [key: string]: string;
}

export interface PluginStatus {
  online: boolean;
  lastError?: string;
}

export type MessageHandler = (payload: MessagePayload) => Promise<void>;
```

### Message Envelope

All channel plugins receive messages in this format:
```typescript
{
  text: string;      // Message content
  sender: string;     // Sender identifier
  channelId: string; // Unique channel identifier
  metadata?: {       // Channel-specific data
    groupId?: string;
    threadId?: string;
  };
  timestamp: number; // Unix timestamp
}
```

### Database Schema

```sql
-- src/db.ts additions
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  version TEXT,
  enabled INTEGER DEFAULT 0,
  installed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plugin_config (
  plugin_id TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  FOREIGN KEY (plugin_id) REFERENCES plugins(id)
);
```

### Plugin Security & Isolation

Following best practices for Node.js plugin systems, implement these security layers:

#### Dynamic Module Loading

```typescript
// src/plugins/loader.ts
import { pathToFileURL } from 'node:url';

export async function loadPlugin(pluginPath: string): Promise<ChannelPlugin> {
  // Resolve to absolute path and convert to file URL for ES modules
  const resolvedPath = path.resolve(pluginPath);
  const moduleUrl = pathToFileURL(resolvedPath).href;
  
  // Dynamic import with validation
  const module = await import(moduleUrl);
  const PluginClass = module.default || module.ChannelPlugin;
  
  if (!PluginClass || typeof PluginClass !== 'function') {
    throw new Error(`Invalid plugin at ${pluginPath}: no valid ChannelPlugin export`);
  }
  
  const plugin = new PluginClass();
  
  // Validate interface implementation
  validatePluginInterface(plugin);
  
  return plugin;
}

function validatePluginInterface(plugin: unknown): asserts plugin is ChannelPlugin {
  const required = ['initialize', 'send', 'connect', 'disconnect', 'isConnected', 'name', 'version'];
  for (const method of required) {
    if (!plugin || typeof (plugin as Record<string, unknown>)[method] !== 'function') {
      throw new Error(`Plugin missing required method: ${method}`);
    }
  }
}
```

#### Security Measures

| Layer | Implementation | Priority |
|-------|----------------|----------|
| **Input Validation** | Zod schemas for all config fields before plugin init | Critical |
| **Path Validation** | Reject plugins outside `public/.agents/plugins/` | Critical |
| **Capability Whitelist** | Plugins only access explicitly exposed APIs | High |
| **Dependency Scanning** | Run `npm audit` on installed plugins | Medium |
| **Audit Logging** | Log all plugin operations with timestamps | Medium |

#### Sandboxing (Future Enhancement)

For MVP, plugins run in same process. For v2, consider Worker thread isolation:

```typescript
// Future: plugin-sandbox.ts
import { Worker } from 'node:worker_threads';

export class PluginSandbox {
  async loadPlugin(pluginPath: string, config: PluginConfig): Promise<string> {
    const worker = new Worker('./plugin-worker.js', {
      eval: true,
      workerData: { pluginPath, config },
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 64
      }
    });
    
    return crypto.randomUUID();
  }
}
```

### Configuration Management

Use Zod for type-safe, validatable configuration schemas:

```typescript
// src/plugins/config/schema.ts
import { z } from 'zod';

// Base configuration shared across all plugins
const BasePluginConfig = z.object({
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(50),
  timeout: z.number().int().positive().max(30000).default(5000),
});

// Signal-specific configuration
export const SignalConfigSchema = BasePluginConfig.extend({
  botNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid E.164 phone format'),
  targetNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid E.164 phone format'),
  targetGroup: z.string().optional(),
  port: z.number().int().min(1024).max(65535).default(8080),
});

export type SignalConfig = z.infer<typeof SignalConfigSchema>;

// Generic config validator
export function validatePluginConfig<T extends z.ZodType>(
  schema: T,
  config: unknown
): z.infer<T> {
  return schema.parse(config);
}
```

#### Config Schema in Plugin Package

Each plugin should include `schema.json` for UI generation and runtime validation:

```json
// public/.agents/plugins/signal/schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "botNumber": {
      "type": "string",
      "pattern": "^\\+[1-9]\\d{1,14}$",
      "description": "Bot's Signal number (E.164 format)"
    },
    "targetNumber": {
      "type": "string",
      "pattern": "^\\+[1-9]\\d{1,14}$",
      "description": "Whitelisted user number"
    },
    "targetGroup": {
      "type": "string",
      "description": "Optional group name for group messages"
    },
    "port": {
      "type": "integer",
      "minimum": 1024,
      "maximum": 65535,
      "default": 8080
    }
  },
  "required": ["botNumber", "targetNumber"]
}
```

### Error Handling Strategies

Implement layered error handling to prevent plugin failures from crashing the system:

#### Error Boundary Pattern

```typescript
// src/plugins/errors.ts
export class PluginErrorBoundary {
  private errorCounts = new Map<string, number>();
  private readonly maxErrors = 5;
  private readonly errorWindowMs = 60000; // 1 minute
  
  async execute<T>(
    plugin: ChannelPlugin,
    operation: () => Promise<T>,
    fallback?: T
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      // Enforce timeout
      return await Promise.race([
        operation(),
        this.createTimeout(plugin.name, 5000)
      ]);
    } catch (error) {
      this.recordError(plugin.name, error);
      
      // Disable plugin if too many errors
      if (this.shouldDisable(plugin.name)) {
        await this.disablePlugin(plugin.name);
      }
      
      if (fallback !== undefined) {
        return fallback;
      }
      
      // Re-throw with context
      throw new PluginExecutionError(plugin.name, operation.name, error);
    }
  }
  
  private createTimeout(pluginName: string, ms: number): Promise<never> {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Plugin ${pluginName} timed out after ${ms}ms`)), ms)
    );
  }
  
  private recordError(pluginName: string, error: unknown): void {
    const count = this.errorCounts.get(pluginName) || 0;
    this.errorCounts.set(pluginName, count + 1);
    console.error(`[Plugin:${pluginName}] Error:`, error);
  }
  
  private shouldDisable(pluginName: string): boolean {
    return (this.errorCounts.get(pluginName) || 0) >= this.maxErrors;
  }
}
```

#### Error Handling Strategy Summary

| Error Type | Handling Approach | User Feedback |
|------------|-------------------|---------------|
| **Init failure** | Log, mark offline, continue startup | UI shows "Failed to load" status |
| **Message handler error** | Catch, log, acknowledge (no retry) | Silent - message not retried |
| **Send failure** | Log, throw to caller | Retry handled by caller |
| **Timeout** | Cancel operation, mark plugin degraded | UI shows "Degraded" status |
| **Repeated failures** | Disable plugin, notify via working channel | Alert on Dashboard |

#### Graceful Degradation

- If Signal fails, other channels continue operating
- Plugin failures are isolated per-channel
- System remains operational even if all plugins fail (just queues messages)

## System-Wide Impact

### Interaction Graph

1. **Startup**: `index.ts` → `ChannelManager.loadPlugins()` → scan `plugins/` → `plugin.init()` → `plugin.start()`
2. **Incoming Message**: `ChannelPlugin.onMessage()` → `MessageRouter.route()` → `processAgentMessage()` → `ChannelPlugin.send()`
3. **Config Change**: Dashboard → `/api/plugins/:id/config` → `ChannelManager.updateConfig()` → `plugin.init()` (re-init)

### Error Propagation

- Plugin init/start failures: Logged, plugin marked as offline, UI shows error status
- Message handler errors: Caught, logged, message acknowledged (no retry for now)
- Send failures: Logged, thrown up to caller for handling

### State Lifecycle

- Plugin enabled → added to `plugins` table with `enabled=1`
- Plugin config updated → stored in `plugin_config` table
- Plugin disabled → `enabled=0`, `plugin.stop()` called
- Plugin removed → rows deleted, files removed from `plugins/`

### API Surface Parity

- New endpoints: `/api/plugins`, `/api/plugins/:id/toggle`, `/api/plugins/:id/config`, `/api/plugins/install`
- Status endpoint extended to include plugin status
- Skills endpoints remain unchanged

## Alternative Approaches Considered

1. **Registry Pattern** - Plugins register themselves; rejected due to tighter coupling
2. **MCP-based Channels** - Use MCP for channel communication; rejected as overkill for synchronous messaging
3. **Keep Signal Hardcoded** - Add if/else for new channels; rejected as not truly plugin-based

## Acceptance Criteria

### Phase 1: Core Infrastructure
- [ ] `src/plugins/types.ts` defines `Plugin` and `ChannelPlugin` interfaces
- [ ] Database schema added for `plugins` and `plugin_config` tables
- [ ] `ChannelManager` loads plugins from `public/.agents/plugins/`
- [ ] Plugins can be started/stopped via manager

### Phase 2: Signal Plugin
- [ ] `public/.agents/plugins/signal/index.ts` implements `ChannelPlugin`
- [ ] `schema.json` defines config: botNumber, targetNumber, targetGroup, port
- [ ] Signal plugin loads and starts successfully
- [ ] Messages received via onMessage callback
- [ ] Messages sent via send() method

### Phase 3: Message Routing
- [ ] `processAgentMessage` receives channelId in payload
- [ ] Responses route to originating channel (reply-to-source)
- [ ] Multiple channels can run simultaneously

### Phase 4: Dashboard UI
- [ ] "Channels" tab added to sidebar (next to Skills)
- [ ] Lists installed channel plugins with status indicators
- [ ] Toggle enable/disable per channel
- [ ] Config form rendered from schema.json
- [ ] Install via GitHub URL

### Phase 5: Plugin Installation
- [ ] `/api/plugins/install` endpoint clones GitHub repo
- [ ] Validates plugin interface implementation
- [ ] Runs `npm install` if package.json exists
- [ ] Plugin appears in Channels list after install

## Dependencies & Risks

### Dependencies
- Existing skills installation pattern (`server.ts:324-490`)
- signal-cli for Signal functionality
- Dashboard React components

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Breaking Change** | High | Signal migration requires careful testing; maintain backward compatibility during transition |
| **Config Migration** | Medium | Existing .env values auto-migrate to plugin config on first load |
| **Plugin Errors** | High | Error boundaries isolate failures; plugins marked offline on repeated errors |
| **Malicious Plugins** | High | Path validation restricts plugins to `public/.agents/plugins/`; validate exports; audit deps |
| **Memory Leaks** | Medium | Track event listeners; require cleanup in `disconnect()`; periodic health checks |
| **Circular Dependencies** | Medium | Use dependency injection; plugins cannot import host directly |
| **Version Mismatch** | Low | Plugin manifest declares version range; validate compatibility on load |
| **Config Injection** | High | Zod validation on all config; reject unknown fields; sanitize sensitive values |

#### Security Risk Details

**Dynamic Module Loading Risks:**
- Plugins execute with same Node.js privileges as host application
- No filesystem isolation in MVP (v2: Worker threads)
- Malicious plugin could access `process.env`, read arbitrary files, or execute system commands

**Mitigations for MVP:**
1. **Path allowlist**: Only load plugins from `public/.agents/plugins/`
2. **Interface validation**: Reject plugins missing required methods
3. **No eval()**: Never use `eval()` or `new Function()` for plugin code
4. **Config sanitization**: Never pass raw user input to plugin without validation

**Future Enhancements (v2):**
- Worker thread sandboxing with resource limits
- Capability-based permissions system
- Plugin signing/verification
- Dependency vulnerability scanning at install time

## Sources & References

### Origin
- **Brainstorm document:** [docs/brainstorms/2026-02-28-channel-plugin-architecture-brainstorm.md](docs/brainstorms/2026-02-28-channel-plugin-architecture-brainstorm.md)
- Key decisions carried forward:
  - Plugin interface with dynamic loader
  - Config via Dashboard UI forms
  - Reply-to-source routing

### Internal References
- Skills pattern: `src/server.ts:324-490`
- Signal implementation: `src/signal.ts:116-276`
- Dashboard Skills tab: `src/ui/src/components/Dashboard.tsx:56-321`
- Database schema: `src/db.ts:25-55`

### External References
- JSON Schema for config forms: https://json-schema.org/
- Node.js VM module (dynamic import): https://nodejs.org/api/vm.html
- Zod validation library: https://zod.dev/
- Plugin architecture patterns: Community best practices from Express, Webpack, and modern TypeScript frameworks

### Research Summary

Based on research into Node.js/TypeScript plugin architectures:

**Key Patterns Adopted:**
- Hook-based plugin system with ChannelAdapter base class
- Dynamic `import()` for module loading with interface validation
- Zod schemas for type-safe configuration validation
- Error boundaries with timeout enforcement and graceful degradation

**Security Considerations:**
- Path validation restricts plugins to designated directory
- Input validation on all configuration before plugin initialization
- Capability whitelisting limits plugin access to exposed APIs
- Audit logging for all plugin operations

**Error Handling Strategy:**
- Per-plugin error boundaries prevent cascade failures
- Timeout enforcement prevents hung plugins
- Automatic disable after repeated failures
- Graceful degradation allows system to operate with failed plugins

### Open Questions (from brainstorm)
- Plugin dependency management - out of scope for MVP
- Plugin isolation/sandboxing - out of scope for MVP
- Plugin update mechanism - out of scope for MVP
- Fallback channel routing - out of scope for MVP
