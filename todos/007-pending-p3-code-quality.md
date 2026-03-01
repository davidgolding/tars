---
status: pending
priority: p3
issue_id: "007"
tags: [code-quality, database, performance]
dependencies: []
---

# Nice-to-Have: Database and Code Quality Improvements

## Problem Statement

Several medium/low priority issues found during review that should be addressed but aren't critical.

## Findings

### 1. Missing Index on Plugin Queries

**Location:** `src/db.ts`

```typescript
// No index on enabled column - will slow down as table grows
db.exec(`CREATE INDEX IF NOT EXISTS idx_plugins_enabled ON plugins(enabled)`);
```

### 2. New Database Connection Per Request

**Location:** `src/server.ts:182-190`

```typescript
const db = new Database(dbPath);  // Creates new connection each request
```

Should reuse existing connection from `db.ts`.

### 3. Silent Failures in Channel Manager

**Location:** `src/plugins/channel-manager.ts:107-110`

Plugin load failures are logged but not propagated to caller.

### 4. Verbose Error Messages

**Location:** `src/server.ts`

Error messages may leak sensitive information in stack traces.

### 5. Inconsistent Error Response Format

API endpoints return different error formats (`{ error }` vs `{ error, details }`).

## Proposed Solutions

### Database Index

```typescript
// Add to db.ts plugin table creation
db.exec(`CREATE INDEX IF NOT EXISTS idx_plugins_enabled ON plugins(enabled)`);
```

### Reuse Database Connection

```typescript
// Import from db.ts instead of creating new
import { db } from './db.js';
```

### Standardize Error Responses

```typescript
// Create helper
function errorResponse(res, message: string, status = 500) {
    return res.status(status).json({ error: message });
}
```

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] Database queries use indexes
- [ ] Single DB connection reused
- [ ] Error responses consistent

## Work Log

### 2026-03-01 - Initial Discovery

**By:** Code Review

**Actions:**
- Documented various minor improvements
