---
title: Dashboard Skills Management Tab Implementation
date: 2026-02-28
problem_type: feature_implementation
severity: n/a
module: UI Dashboard, Express API
tags:
  - dashboard
  - skills
  - express-api
  - preact-ui
  - crud-operations
  - filesystem-based-activation
  - yaml-parsing
  - path-traversal
status: documented
---

# Dashboard Skills Management Tab

Added a "Skills" top-level tab to the Tars dashboard providing full CRUD management for agent skills. Skills are filesystem-based (`SKILL.md` with YAML frontmatter), managed by moving folders between `public/.agents/skills/` (active) and `public/.agents/inactive-skills/` (inactive).

## Files Modified

| File | Changes |
|------|---------|
| `src/server.ts` | 4 new API endpoints, `SYSTEM_SKILLS` constant, `parseSkillMd()` helper, `isValidSkillName()` validator |
| `src/ui/src/components/Dashboard.tsx` | Skills tab, list view, detail view, install form, toggle/remove handlers, restart banner, extracted `markdownComponents` |

## Key Implementation Decisions

### 1. Regex-Based YAML Frontmatter Parsing

The `yaml` package appeared in `node_modules` as a transitive dependency but was not reliably importable. Instead of adding a new dependency, SKILL.md parsing uses simple regex:

```typescript
function parseSkillMd(filePath: string, folderId: string) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return { name: folderId, description: '', content: raw };

    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    return {
        name: nameMatch ? nameMatch[1].trim() : folderId,
        description: descMatch ? descMatch[1].trim() : '',
        content: match[2].trim(),
    };
}
```

**Lesson:** Don't assume transitive npm dependencies are available. Check importability before relying on them. For simple, well-structured formats, regex parsing avoids dependency risk entirely.

### 2. Filesystem-Based Activation

Toggling a skill moves its entire folder between `skills/` and `inactive-skills/` via `fs.renameSync()`. Benefits:

- Mastra's `Workspace` only scans `skills/` — inactive skills are automatically excluded without code changes
- Deactivation is reversible (soft delete)
- State is observable via filesystem inspection

**Critical:** Always call `fs.mkdirSync(targetDir, { recursive: true })` before `fs.renameSync()`. The `inactive-skills/` directory doesn't exist until first use.

### 3. Server-Side System Skill Protection

System skills (`find-skills`, `scheduling`, `self-update`) are protected with a 403 response on both toggle and delete endpoints. UI buttons are replaced with a "System" badge, but the server-side check is the real enforcement:

```typescript
const SYSTEM_SKILLS = ['find-skills', 'scheduling', 'self-update'];

if (SYSTEM_SKILLS.includes(name)) {
    return res.status(403).json({ error: 'Cannot toggle a system skill' });
}
```

**Lesson:** Never rely solely on UI-side protection. A `curl` command bypasses disabled buttons trivially.

### 4. Path Traversal Prevention

Every endpoint accepting a skill name validates it before any filesystem operation:

```typescript
function isValidSkillName(name: string): boolean {
    return !!name && !name.includes('/') && !name.includes('\\')
        && !name.includes('..') && !name.includes('\0');
}
```

Returns 400 on invalid names. This is a security boundary — skill names become filesystem paths.

### 5. Partial Install Cleanup

The install endpoint runs `npx -y @anthropic-ai/skills add` with a 60-second timeout. On failure, any partially created skill folder is cleaned up:

```typescript
if (err) {
    if (fs.existsSync(activePath)) {
        fs.rmSync(activePath, { recursive: true, force: true });
    }
    reject(new Error(stderr || err.message));
}
```

Duplicate installs are rejected with 409 Conflict before the subprocess runs.

## UI Patterns

### Toggle Button (mirrors Signal Daemon pattern)

The skill toggle button reuses the exact same visual pattern as the Signal daemon start/stop button — green for activate, red for deactivate, spinner while in-flight, disabled state during operation. The `SkillToggleButton` component handles both compact (list row) and full-size (detail view) variants.

### Extracted Markdown Components

The `markdownComponents` object was extracted from inline definitions to a shared constant, reused by both chat message rendering and skill content rendering. Prevents style drift between Markdown surfaces.

### Restart Banner

A yellow warning banner appears after any skill toggle/install/remove operation. The `restartNeeded` state flag persists across list/detail view navigation. The banner includes a "Restart Now" button wired to `POST /api/system/restart`.

### Refetch on Tab Switch

Skills are refetched every time the user switches to the Skills tab, catching any external changes (CLI installs, manual filesystem edits).

## API Endpoints

| Method | Path | Purpose | Protected |
|--------|------|---------|-----------|
| GET | `/api/skills` | List all skills (active + inactive) | - |
| POST | `/api/skills/:name/toggle` | Move skill between active/inactive | System skills: 403 |
| DELETE | `/api/skills/:name` | Permanently remove skill | System skills: 403 |
| POST | `/api/skills/install` | Install from registry or URL | Duplicate: 409 |

## Prevention Strategies

1. **Check transitive deps before importing** — `yaml` appeared available but wasn't. Use `node -e "import('pkg')"` to verify.
2. **Lazy directory creation** — Use `mkdirSync({ recursive: true })` before any rename/move to a directory that may not exist yet.
3. **Server-side access control** — Always enforce permissions server-side, not just via disabled UI controls.
4. **Sanitize path parameters** — Any API parameter that becomes part of a filesystem path must be validated for traversal characters.
5. **Clean up partial operations** — External subprocess failures should trigger cleanup of any partially created state.
6. **Restart awareness** — When changes don't take effect until restart, make this visible to the user with a persistent banner.

## Related Documentation

- [Express 5 Wildcard Routing](../runtime-errors/express-5-wildcard-routing-error-System-20260227.md) — Express 5 `path-to-regexp` v8 changes
- [Vite Tailwind v4 Resolution](../build-errors/vite-tailwind-v4-resolution-error-UI-20260227.md) — Tailwind v4 + Vite setup requirements
- [Dashboard Messaging Integration](../integration-issues/dashboard-messaging-interface-integration-UIDashboard-20260227.md) — Dashboard patterns, ReactMarkdown, SSE
