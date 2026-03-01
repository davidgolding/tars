---
status: pending
priority: p2
issue_id: "005"
tags: [typescript, types, code-quality]
dependencies: []
---

# High: Extensive `any` Type Usage Reduces Type Safety

## Problem Statement

Multiple locations in the codebase use `any` type, which defeats TypeScript's type safety and can cause runtime errors.

## Findings

**Evidence from TypeScript review:**

1. **src/db.ts:212** - Database query values
```typescript
const values: any[] = [];
```

2. **src/ui/src/components/Dashboard.tsx** - Multiple locations
```typescript
// Line 39-57: Markdown component props
const isBlock = /language-(\w+)/.test(className || '');

// Line 66: Status state
const [status, setStatus] = useState<any>(null);

// Line 931: Schema property access
{Object.entries(channel.schema.properties || {}).map(([key, prop]: [string, any]) => (
```

3. **public/.agents/plugins/signal/index.ts:162** - Group finding
```typescript
const group = groups.find((g: any) => g.name === this.config.targetGroup);
```

4. **src/mastra/service.ts:101** - Error handling
```typescript
} catch (err: any) {
```

## Proposed Solutions

### Option 1: Define Proper Interfaces (Recommended)

**Approach:** Create TypeScript interfaces for these types.

```typescript
// types.ts
interface Status {
  bootstrapped: boolean;
  timestamp?: string;
  botNumber?: string;
  targetNumber?: string;
  signalOnline?: boolean;
}

interface SchemaProperty {
  type: string;
  title?: string;
  description?: string;
  required?: string[];
}
```

**Pros:**
- Full type safety
- Self-documenting code

**Effort:** 2-3 hours

**Risk:** Low

---

### Option 2: Use `unknown` Instead of `any`

**Approach:** Replace `any` with `unknown` and add type guards.

```typescript
const values: unknown[] = [];
// Later: const typed = values as string[];
```

**Pros:**
- Quick fix
- Forces type checking

**Effort:** 30 minutes

**Risk:** Low

---

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/db.ts`
- `src/ui/src/components/Dashboard.tsx`
- `public/.agents/plugins/signal/index.ts`
- `src/mastra/service.ts`

## Acceptance Criteria

- [ ] No `any` types in critical paths
- [ ] Interfaces defined for complex types

## Work Log

### 2026-03-01 - Initial Discovery

**By:** TypeScript Review

**Actions:**
- Found multiple `any` usages across codebase
