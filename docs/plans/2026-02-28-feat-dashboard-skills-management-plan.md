---
title: "feat: Dashboard Skills Management Tab"
type: feat
status: completed
date: 2026-02-28
origin: docs/brainstorms/2026-02-28-dashboard-skills-management-brainstorm.md
---

# feat: Dashboard Skills Management Tab

## Overview

Add a "Skills" top-level tab to the Tars dashboard that provides full CRUD management for agent skills — list, view, activate/deactivate, install, and remove. Skills are filesystem-based (`SKILL.md` with YAML frontmatter), managed by moving folders between `public/.agents/skills/` (active) and `public/.agents/inactive-skills/` (inactive). System skills (`find-skills`, `scheduling`, `self-update`) are protected from modification.

## Problem Statement / Motivation

Skills are currently managed only via CLI (`pnpx mastra skills add`). Users have no visibility into which skills are loaded, no way to toggle them on/off, and no UI for installation or removal. The dashboard already manages the Signal daemon and agent settings — skills management is the natural next surface.

## Proposed Solution

### Design Decisions (from brainstorm)

- **Top-level tab** in sidebar, not an expandable section (see brainstorm)
- **Inline detail view** — list view in content area, clicking a skill replaces it with a detail view + back button (see brainstorm: Approach A)
- **Filesystem-based activation** — folder moves between `skills/` and `inactive-skills/`, no DB flags (see brainstorm)
- **Folder name is canonical ID** — API routes use folder name, not frontmatter `name` field. `GET /api/skills` returns `id` (folder name) and `name` (frontmatter display name).

### Design Decisions (new, from SpecFlow analysis)

- **Server-side system skill protection** — `POST /api/skills/toggle` and `DELETE /api/skills/:name` return 403 for system skills. UI-only protection is insufficient.
- **Lazy directory creation** — Server creates `inactive-skills/` via `fs.mkdirSync(path, { recursive: true })` before any rename operation.
- **Restart banner after toggle** — Yellow info banner: "Restart Tars for this change to take effect." Toggle does not hot-reload the agent.
- **Toggle and remove on both list and detail views** — Compact toggle on list rows; full toggle + remove in detail view header.
- **System skills show a "System" badge** — Replaces the toggle/remove buttons entirely (not disabled buttons).
- **Install is synchronous POST** — Blocks with 60s timeout. Simpler than SSE for v1; can upgrade to streaming later if needed.
- **Install input heuristic** — Input starting with `https://` or `github.com/` is treated as a GitHub URL; anything else is a registry slug passed to `pnpx mastra skills add`.
- **409 on duplicate install** — If folder name already exists (active or inactive), return 409 Conflict.
- **Graceful fallback for missing SKILL.md** — Show skill in list with folder name as display name, no description, yellow warning dot. All controls still work.
- **Alphabetical sort** — By folder name. System skills are not separated, just badged.
- **Empty state** — "No skills installed" message with the install input prominently displayed.
- **Path traversal protection** — Sanitize `:name` param: reject if it contains `/`, `..`, or null bytes.

## Implementation Phases

### Phase 1: Backend API (`src/server.ts`)

Add four new endpoints to the Express API router.

#### `GET /api/skills`

Returns all skills from both directories.

**`src/server.ts` — new route**

```ts
// GET /api/skills
// Reads public/.agents/skills/ and public/.agents/inactive-skills/
// For each subfolder: parse SKILL.md frontmatter (name, description), determine active status
// Returns: { skills: Array<{ id: string, name: string, description: string, active: boolean, isSystem: boolean }> }
```

- Parse SKILL.md frontmatter by splitting on `---` delimiters and using the transitive `yaml` package (already in node_modules as `yaml@2.8.2`)
- If SKILL.md is missing or malformed: use folder name as `name`, empty `description`, still include in response
- `isSystem` is `SYSTEM_SKILLS.includes(id)` where `SYSTEM_SKILLS = ['find-skills', 'scheduling', 'self-update']`
- Sort alphabetically by `id`
- Create directories with `{ recursive: true }` if they don't exist before reading

#### `POST /api/skills/:name/toggle`

Moves a skill folder between active and inactive directories.

```ts
// POST /api/skills/:name/toggle
// Validates: name does not contain '/', '..', or null bytes
// Validates: name is not in SYSTEM_SKILLS (return 403)
// Determines current location (skills/ or inactive-skills/)
// fs.mkdirSync target dir with { recursive: true }
// fs.renameSync source folder to target folder
// Returns: { success: true, active: boolean }
```

#### `DELETE /api/skills/:name`

Permanently removes a skill folder.

```ts
// DELETE /api/skills/:name
// Validates: name sanitization + not system skill (403)
// Finds folder in skills/ or inactive-skills/
// fs.rmSync(folderPath, { recursive: true, force: true })
// Returns: { success: true }
```

#### `POST /api/skills/install`

Installs a skill from registry or URL.

```ts
// POST /api/skills/install
// Body: { source: string } — validated with Zod
// Determines if source is URL (starts with https:// or github.com/) or registry slug
// Checks for existing folder name conflict → 409
// Runs: exec('pnpx mastra skills add <source>') with cwd: WORKSPACE_PATH, timeout: 60000
// Returns: { success: true, skill: { id, name, description } }
// On subprocess failure: clean up partial folder, return 500 with stderr
```

**Files to modify:**

- `src/server.ts` — Add 4 routes, add `SYSTEM_SKILLS` constant, add SKILL.md parser helper function

**Helper function for SKILL.md parsing:**

```ts
// parseSkillMd(filePath: string): { name: string, description: string, content: string }
// Split file on /^---$/m, parse YAML block with yaml.parse(), body is everything after second ---
// On error: return { name: folderName, description: '', content: '' }
```

### Phase 2: Frontend — Skills Tab & List View (`src/ui/src/components/Dashboard.tsx`)

#### Add tab entry

Add `{ id: 'skills', label: 'Skills', icon: '<puzzle-piece-svg>' }` to the `tabs` array (around line 236).

#### Skills list view

New `{activeTab === 'skills' && (...)}` block in the content `<section>`.

**State additions:**

```ts
const [skills, setSkills] = useState<Skill[]>([]);
const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
const [isLoadingSkills, setIsLoadingSkills] = useState(false);
const [togglingSkill, setTogglingSkill] = useState<string | null>(null); // skill id being toggled
const [installInput, setInstallInput] = useState('');
const [isInstalling, setIsInstalling] = useState(false);
const [showRawContent, setShowRawContent] = useState(false);
const [restartNeeded, setRestartNeeded] = useState(false);
```

**Skill type:**

```ts
interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  active: boolean;
  isSystem: boolean;
}
```

**List layout:**

```
┌─────────────────────────────────────────────────────┐
│ Skills                                              │
│─────────────────────────────────────────────────────│
│ ⚠ Restart needed for changes to take effect [btn]  │  ← yellow banner, shown when restartNeeded
│─────────────────────────────────────────────────────│
│ Install: [___registry name or GitHub URL___] [Add]  │
│─────────────────────────────────────────────────────│
│ 🟢 find-skills          Discover and install...  [System] │
│ 🟢 notesmd              Create and manage...    [Toggle][Remove] │
│ 🟢 scheduling           Schedule recurring...   [System] │
│ 🔴 obsidian-markdown    Obsidian-flavored...    [Toggle][Remove] │
│ 🟢 self-update          Self-update agent...    [System] │
└─────────────────────────────────────────────────────┘
```

- Green/red dot: `bg-green-500` or `bg-red-500` circle (`w-2 h-2 rounded-full`)
- Toggle button: mirrors Signal daemon button pattern — green "Activate" / red "Deactivate" with spinner while in flight
- System skills: toggle + remove replaced by a `text-gray-500 bg-gray-800/50 border-gray-700` "System" badge
- Remove button: small `text-red-400` button, opens danger confirmation modal
- Rows are clickable (entire row navigates to detail view)
- Empty state: "No skills installed. Use the input above to add one."

**Data fetching:**

```ts
// fetchSkills() — called on mount and after toggle/remove/install
// GET /api/skills → setSkills(data.skills)
```

Add `fetchSkills()` to the existing `useEffect` that fetches status on mount.

### Phase 3: Frontend — Detail View

When `selectedSkill` is set, render the detail view instead of the list.

**Detail layout:**

```
┌─────────────────────────────────────────────────────┐
│ ← Back to Skills                                    │
│─────────────────────────────────────────────────────│
│ scheduling                          [System badge]  │
│ Schedule recurring and one-shot tasks...            │
│─────────────────────────────────────────────────────│
│  OR for non-system skills:                          │
│ notesmd                    [Deactivate] [Remove]    │
│ Create and manage notes...                          │
│─────────────────────────────────────────────────────│
│ Content                    [Rendered] | [Raw]       │
│─────────────────────────────────────────────────────│
│ # Skill Instructions                                │
│ This skill allows you to...                         │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
```

- Back button: `← Back to Skills` link, sets `selectedSkill = null` and resets `showRawContent = false`
- Name: large heading
- Toggle button: same pattern as list view, full-size
- Remove button: red outline button, triggers confirmation modal, navigates back to list on success
- Content toggle: two buttons (`Rendered` / `Raw`), active one has `bg-brand/10 text-brand` styling
- Rendered view: `<ReactMarkdown>` with `remarkGfm` and `remarkBreaks` (already imported in Dashboard.tsx for chat)
- Raw view: `<pre>` block with `bg-gray-950 p-4 rounded-lg overflow-auto text-sm text-gray-300 font-mono`

**Note on content:** The `GET /api/skills` endpoint returns the full `content` (Markdown body) for each skill. This avoids a separate detail-fetch endpoint. The payload is small enough (skills are typically 1-5KB of Markdown).

### Phase 4: Install Flow

The install input lives at the top of the skills list view.

**Install flow:**

1. User types into input, clicks "Add" (or presses Enter)
2. `setIsInstalling(true)`, POST to `/api/skills/install` with `{ source: installInput }`
3. On success: clear input, `fetchSkills()`, show success modal
4. On 409: show info modal "Skill already exists"
5. On error: show danger modal with error message
6. `setIsInstalling(false)`

**Input styling:** matches existing form inputs in the dashboard — `bg-gray-800 border-gray-700 text-gray-100 rounded-lg px-3 py-2`. Add button styled like the Signal daemon "Start" button (green tint).

### Phase 5: Integration & Polish

- **Restart banner:** After any successful toggle, set `restartNeeded = true`. Show a yellow warning bar at the top of the skills content area: "Skill changes require a restart to take effect." with a "Restart Now" button that calls `POST /api/system/restart` (reusing existing restart logic).
- **Refetch on tab switch:** When switching to the skills tab, refetch the skills list to pick up any external changes.
- **Loading skeleton:** While `isLoadingSkills` is true, show 3-4 pulsing placeholder rows (`animate-pulse bg-gray-800 rounded-lg h-12`).

## Technical Considerations

- **Express 5 routing:** Use `router.delete('/skills/:name', ...)` — Express 5 handles named params fine. Avoid wildcard patterns per the learnings doc (use regex if needed).
- **Path traversal:** The `:name` parameter must be sanitized before any filesystem operation. Reject names containing `/`, `..`, `\0`. This is a security boundary.
- **Tailwind v4:** No config file needed. Custom classes use the existing `@theme` setup. The `text-brand` / `bg-brand` color is already defined.
- **Preact compatibility:** Use `import { useState, useEffect, useRef } from 'preact/hooks'` (already imported). `ReactMarkdown` works with Preact via the preset-vite alias.
- **YAML parsing on server:** Use `import { parse as parseYaml } from 'yaml'` — the `yaml` package is a transitive dep already in `node_modules`. Alternatively, add `gray-matter` as a direct dependency for cleaner frontmatter parsing. A simple regex split on `---` + `yaml.parse()` is sufficient and avoids a new dependency.

## Acceptance Criteria

### Functional Requirements

- [ ] Skills tab appears in sidebar navigation
- [ ] Skills list shows all skills from both `skills/` and `inactive-skills/` with correct status dots
- [ ] Clicking a skill shows its detail view with name, description, and rendered Markdown content
- [ ] Content toggle switches between rendered and raw Markdown
- [ ] Back button returns to list view
- [ ] Toggle button activates/deactivates skills by moving folders between directories
- [ ] Toggle shows loading spinner during operation
- [ ] Remove button shows danger confirmation modal before deleting
- [ ] After removal from detail view, UI returns to list
- [ ] Install input accepts registry names and GitHub URLs
- [ ] Install shows loading state and success/error feedback
- [ ] Duplicate install returns 409 with clear message
- [ ] System skills (`find-skills`, `scheduling`, `self-update`) show "System" badge instead of toggle/remove
- [ ] System skill protection is enforced server-side (403 on toggle/delete)
- [ ] Path traversal attempts are rejected (400)
- [ ] Yellow restart banner appears after toggle operations
- [ ] Empty state shows helpful message when no skills exist
- [ ] Skills without valid SKILL.md appear in list with folder name fallback

### Non-Functional Requirements

- [ ] No new npm dependencies required (uses transitive `yaml` package + existing `react-markdown`)
- [ ] API responses under 200ms for list/toggle/delete operations
- [ ] Install timeout capped at 60 seconds

## Dependencies & Risks

- **`yaml` package availability:** Currently a transitive dependency. If a future dependency update removes it, the SKILL.md parser breaks. Mitigation: add `yaml` as a direct dependency in `package.json`, or use a regex-based parser.
- **Install command uncertainty:** The exact `pnpx mastra skills add` invocation and its argument format for URLs needs verification. Mitigation: test the install subprocess manually before wiring up the API.
- **Agent hot-reload:** Skills changes don't take effect until restart. This is a known limitation documented via the restart banner. Future improvement: investigate Mastra workspace reload API.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/server.ts` | Modify | Add 4 API endpoints, SYSTEM_SKILLS constant, parseSkillMd helper |
| `src/ui/src/components/Dashboard.tsx` | Modify | Add Skills tab, list view, detail view, install form, state management |

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-02-28-dashboard-skills-management-brainstorm.md](docs/brainstorms/2026-02-28-dashboard-skills-management-brainstorm.md) — Key decisions: top-level tab with inline detail view, filesystem-based activation, system skill protection list, install supports name + URL.

### Internal References

- Signal daemon toggle pattern: `src/ui/src/components/Dashboard.tsx:479-499`
- Modal usage: `src/ui/src/components/Modal.tsx`
- Express API patterns: `src/server.ts:49-320`
- Workspace skills config: `src/mastra/workspace.ts:28-30`
- SKILL.md examples: `public/.agents/skills/scheduling/SKILL.md`

### Institutional Learnings

- Express 5 wildcard routing: `docs/solutions/runtime-errors/express-5-wildcard-routing-error-System-20260227.md`
- Tailwind v4 setup: `docs/solutions/build-errors/vite-tailwind-v4-resolution-error-UI-20260227.md`
