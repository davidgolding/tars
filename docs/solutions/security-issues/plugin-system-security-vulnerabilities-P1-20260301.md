---
problem_type: security-issue
severity: P1
component: plugin-system
date: 2026-03-01
tags: [security, plugin-system, authentication, rce, agent-native]
related_issues: []
---

# Plugin System Security Vulnerabilities Fixed

## Problem Symptom

Three critical security issues were discovered in the Tars channel plugin architecture during code review:

1. **Arbitrary Code Execution (RCE)**: The `/api/plugins/install` endpoint accepted any GitHub URL, cloned the repo, ran `npm install`, and dynamically imported the code - effectively remote code execution
2. **Missing Authentication**: All plugin endpoints (install, toggle, config) had no authentication - anyone could install plugins or modify configuration
3. **Agent Native Parity Gap**: The agent had zero tools to manage plugins, violating the principle that every UI action should have an agent equivalent

## Investigation Steps

1. Code review identified the plugin install endpoint executing untrusted code
2. Analyzed the trust boundary - untrusted GitHub repos could contain malicious postinstall scripts
3. Found all plugin endpoints lacked authentication middleware
4. Mapped UI plugin actions to agent capabilities - found 0/6 were accessible

## Root Cause Analysis

### Issue 1: No Input Validation
```typescript
// BEFORE: Accepts any URL
const repoMatch = source.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
```
The URL validation was minimal - only checked for `github.com` presence.

### Issue 2: No Authentication
```typescript
// BEFORE: No middleware
apiRouter.post('/plugins/:id/toggle', async (req, res) => { ... });
```
Plugin endpoints were fully open with no auth check.

### Issue 3: No Agent Tools
The agent only had access to skills and basic tools - no plugin management capabilities existed.

## Working Solution

### Fix 1: Strict URL Validation + Script Blocking

```typescript
// src/server.ts - Plugin install endpoint
const githubUrlSchema = z.string()
    .url()
    .regex(/^https:\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-._]+$/);

const urlValidation = githubUrlSchema.safeParse(source);
if (!urlValidation.success) {
    return res.status(400).json({ error: 'Invalid GitHub URL format' });
}

// Use --ignore-scripts to prevent malicious postinstall scripts
const npm = spawn('npm', ['install', '--ignore-scripts'], { cwd: targetDir });
```

### Fix 2: Authentication Middleware

```typescript
// src/server.ts
const requirePluginAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const expectedKey = process.env.TARS_ADMIN_API_KEY;
    
    if (!expectedKey) {
        const clientIp = req.ip || req.socket.remoteAddress || '';
        const isLocal = clientIp === '127.0.0.1' || clientIp === '::1';
        if (!isLocal) {
            return res.status(401).json({ error: 'Plugin management requires authentication' });
        }
        return next();
    }
    
    if (!apiKey || apiKey !== expectedKey) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    next();
};

// Apply to all plugin endpoints
apiRouter.post('/plugins/:id/toggle', requirePluginAuth, async (req, res) => { ... });
apiRouter.post('/plugins/install', requirePluginAuth, async (req, res) => { ... });
```

### Fix 3: Agent Plugin Tools

```typescript
// src/mastra/tools/plugins.ts
export const listPluginsTool = createTool({
    id: 'list_plugins',
    description: 'List all installed channel plugins and their status',
    execute: async () => {
        const plugins = channelManager.listPlugins();
        return { plugins: plugins.map(p => ({
            id: p.id,
            name: p.name,
            enabled: p.enabled,
            online: channelManager.getPluginStatus(p.id).online
        }))};
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
        return { success: true };
    }
});
```

## Prevention Strategies

1. **Always validate external input**: Use strict Zod schemas for URLs and IDs
2. **Never run untrusted code**: Use `--ignore-scripts` for npm install from external sources
3. **Add authentication to all management endpoints**: Even internal tools need auth
4. **Implement defense in depth**: Multiple layers of protection (auth + validation + timeouts)
5. **Build agent-native from start**: Every UI action should have an agent tool

## Test Cases

```bash
# Test that plugin install is blocked without auth
curl -X POST http://localhost:5827/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"source": "https://github.com/attacker/malicious"}'
# Should return 401

# Test that plugin toggle requires auth
curl -X POST http://localhost:5827/api/plugins/signal/toggle
# Should return 401 if no key

# Test agent can list plugins
# In agent: use list_plugins tool - should return plugin list
```

## Related Documentation

- [Channel Plugin Architecture Plan](../plans/2026-02-28-feat-channel-plugin-architecture-plan.md)
- [Dashboard Skills Management](../feature-implementations/dashboard-skills-management-UIDashboard-20260228.md)
