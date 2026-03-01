---
status: complete
priority: p1
issue_id: "002"
tags: [security, critical, authentication]
dependencies: []
---

# Critical: No Authentication on Plugin Management Endpoints

## Problem Statement

All plugin management endpoints (`/api/plugins/install`, `/api/plugins/:id/toggle`, `/api/plugins/:id/config`) have NO authentication. Anyone can:
- Install arbitrary plugins (combined with finding #1 = RCE)
- Toggle plugins on/off
- Modify plugin configuration

## Findings

**Evidence from security review:**

```typescript
// src/server.ts lines 519-565
// No auth middleware - anyone can toggle plugins
apiRouter.post('/plugins/:id/toggle', async (req, res) => { ... });

// No auth middleware - anyone can modify config  
apiRouter.put('/plugins/:id/config', async (req, res) => { ... });

// No auth middleware - anyone can install plugins
apiRouter.post('/plugins/install', async (req, res) => { ... });
```

**Impact:**
- Unauthenticated remote code execution (when combined with #1)
- Service disruption by disabling plugins
- Configuration manipulation

## Proposed Solutions

### Option 1: Add API Key Authentication (Recommended)

**Approach:** Add a simple API key check for plugin endpoints.

```typescript
const requireAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.ADMIN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

apiRouter.post('/plugins/install', requireAuth, async (req, res) => { ... });
apiRouter.post('/plugins/:id/toggle', requireAuth, async (req, res) => { ... });
apiRouter.put('/plugins/:id/config', requireAuth, async (req, res) => { ... });
```

**Pros:**
- Simple to implement
- Effective for single-user/local deployment

**Cons:**
- Single key for all admin operations
- Key exposed in UI requests

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Require Signal Number Authentication

**Approach:** Only allow requests from the whitelisted Signal number.

```typescript
const requireTrustedSource = (req, res, next) => {
    // Check against TARGET_SIGNAL_NUMBER from env
    const trustedNumber = process.env.TARGET_SIGNAL_NUMBER;
    // For now, local requests only
    if (req.ip !== '127.0.0.1' && req.ip !== '::1') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};
```

**Pros:**
- Aligns with existing security model
- No additional secrets needed

**Cons:**
- Only works for local requests

**Effort:** 1 hour

**Risk:** Low

---

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/server.ts:519-565` - Plugin API endpoints

**Database changes:** None

## Resources

- **PR:** Current branch (dev)
- **Related:** Finding #1 (RCE via plugin install)

## Acceptance Criteria

- [ ] All plugin endpoints require authentication
- [ ] Unauthorized requests are rejected with 401

## Work Log

### 2026-03-01 - Initial Discovery

**By:** Code Review

**Actions:**
- Identified missing authentication on all plugin endpoints

**Learnings:**
- Combined with #1, this creates unauthenticated RCE

---

### 2026-03-01 - Fix Applied

**By:** Claude Code

**Actions:**
- Added `requirePluginAuth` middleware to all plugin endpoints
- Supports two auth modes:
  1. If TARS_ADMIN_API_KEY env var set: requires valid API key in X-API-Key header
  2. If not set: only allows local requests (127.0.0.1)
- Added Zod validation for plugin IDs to prevent injection

**Learnings:**
- Defense in depth: auth + validation
