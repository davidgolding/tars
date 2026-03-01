---
status: pending
priority: p2
issue_id: "004"
tags: [security, input-validation, plugin-system]
dependencies: ["001", "002"]
---

# High: Weak Input Validation on Plugin Endpoints

## Problem Statement

Plugin IDs from URL parameters are used directly without validation. While not as critical as #1 and #2 (which must be fixed first), this could lead to path traversal or injection issues.

## Findings

**Evidence:**

```typescript
// src/server.ts:519 - No validation on :id param
apiRouter.post('/plugins/:id/toggle', async (req, res) => {
    const { id } = req.params;  // Used directly
    const plugin = channelManager.getPlugin(id);  // Could be manipulated
```

```typescript
// src/server.ts:574 - Weak GitHub URL validation
const repoMatch = source.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
if (!repoMatch) {
    return res.status(400).json({ error: 'Invalid GitHub URL' });
}
// Only checks for github.com presence, not strict format
```

**Issues:**
- Accepts any string as plugin ID
- URL validation could be bypassed
- No sanitization before file system operations

## Proposed Solutions

### Option 1: Add Zod Validation

**Approach:** Use Zod to validate inputs.

```typescript
const pluginIdSchema = z.string().regex(/^[a-z0-9-]+$/);

apiRouter.post('/plugins/:id/toggle', async (req, res) => {
    const validation = pluginIdSchema.safeParse(req.params.id);
    if (!validation.success) {
        return res.status(400).json({ error: 'Invalid plugin ID' });
    }
    // ...
});
```

**Pros:**
- Follows existing pattern (Zod is already used elsewhere)
- Comprehensive validation

**Effort:** 1 hour

**Risk:** Low

---

### Option 2: Use Strict GitHub URL Regex

**Approach:** Validate GitHub URL format strictly.

```typescript
const githubUrlSchema = z.string()
    .url()
    .regex(/^https:\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-._]+$/);

const { source } = installSchema.parse(req.body);
```

**Pros:**
- Prevents URL manipulation

**Effort:** 30 minutes

**Risk:** Low

---

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/server.ts:519, 541, 551, 574`

## Acceptance Criteria

- [ ] Plugin IDs validated before use
- [ ] GitHub URLs validated strictly

## Work Log

### 2026-03-01 - Initial Discovery

**By:** Code Review

**Actions:**
- Identified weak input validation on endpoints

**Learnings:**
- Dependencies on #1, #2 (must fix auth first)
