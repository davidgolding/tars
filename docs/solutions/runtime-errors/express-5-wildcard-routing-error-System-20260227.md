---
module: System
date: 2026-02-27
problem_type: runtime_error
component: tooling
symptoms:
  - "PathError [TypeError]: Missing parameter name at index 1: *"
  - "Express 5 server crashes on startup with path-to-regexp error"
root_cause: wrong_api
resolution_type: code_fix
severity: critical
tags: [express-5, path-to-regexp, wildcard, routing]
---

# Troubleshooting: Express 5 Wildcard Routing Error

## Problem
After upgrading to Express 5 or using it in a new project, standard wildcard routes like `app.get('*', ...)` or `app.get('(.*)', ...)` caused the server to crash immediately on startup with a `PathError`. This was due to changes in how the underlying `path-to-regexp` library handles capture groups and wildcards.

## Environment
- Module: System (Express Server)
- Affected Component: API/UI Routing
- Date: 2026-02-27

## Symptoms
- Exact error message: `PathError [TypeError]: Missing parameter name at index 1: *; visit https://git.new/pathToRegexpError for info`
- The server would fail to initialize, preventing any routes (including API routes) from being served.

## What Didn't Work

**Attempted Solution 1:** Using the Express 4 style wildcard `*`.
- **Why it failed:** Express 5 uses `path-to-regexp` v8, which no longer supports the raw `*` character as a catch-all without a parameter name.

**Attempted Solution 2:** Using the common capture group style `(.*)`.
- **Why it failed:** `path-to-regexp` v8 treats parentheses as capturing groups that *must* have a name (e.g., `/:path(.*)`).

**Attempted Solution 3:** Using named wildcard `/:path*`.
- **Why it failed:** While closer to the correct syntax, it still encountered parsing errors in certain configurations when combined with other middleware or regex-like strings.

## Solution

The solution was to bypass the string-based path parser entirely and use a **Regex Literal** for the catch-all route. This is more robust in Express 5 and allowed for easier exclusion of the `/api` prefix.

**Code changes:**
```typescript
# Before (broken):
app.get('*', async (req, res, next) => { ... });

# After (fixed):
// Use a regex that matches everything EXCEPT routes starting with /api
app.get(/^(?!\/api).+/, async (req, res, next) => {
    // Handling for SPA fallback
    const url = req.originalUrl;
    // ...
});
```

## Why This Works

1. **Root Cause**: Express 5 upgraded its routing engine (`path-to-regexp`) to a version that enforces stricter rules for named parameters. Anonymous wildcards are no longer supported.
2. **Resolution**: By providing a Regex literal to `app.get()`, Express skips the `path-to-regexp` string parsing phase and uses the native JavaScript RegExp engine to match the route. This avoids the `PathError` and provides more precise control over which routes should trigger the SPA fallback.

## Prevention

- When using Express 5, prefer **Regex Literals** for complex catch-all or fallback routes.
- If using strings for wildcards, ensure they are named: `/:path*` instead of `*`.
- Consult the [path-to-regexp documentation](https://github.com/pillarjs/path-to-regexp) for the specific version used by your Express installation (Express 5 uses v8+).

## Related Issues

No related issues documented yet.
