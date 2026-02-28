# Dashboard Skills Management

**Date:** 2026-02-28
**Status:** Brainstorm

## What We're Building

A "Skills" tab in the Tars dashboard that lets users view, activate/deactivate, install, and remove agent skills. Skills are Markdown instruction files (in `SKILL.md` with YAML frontmatter) that extend the Tars agent's capabilities. Currently they're managed only via CLI — this brings full CRUD to the UI.

### Core Capabilities

1. **Skills list view** — A top-level "Skills" tab in the sidebar. Main content area shows all skills (active + inactive) with green/red status dots.
2. **Skill detail view** — Clicking a skill navigates to a detail view showing name, description, and content (Markdown rendered by default, with a toggle to raw source). Back button returns to list.
3. **Activate/deactivate toggle** — Mirrors the Signal Daemon start/stop button pattern. Active skills live in `public/.agents/skills/`; deactivated skills are moved to `public/.agents/inactive-skills/`.
4. **Remove skill** — Permanently deletes the skill folder. Confirmation modal (danger type) before deletion.
5. **Install skill** — Text input accepting either a registry skill name or a GitHub URL/repo path. Runs the install process server-side.
6. **System skill protection** — `find-skills`, `scheduling`, and `self-update` are system-required skills. Their toggle and remove controls are disabled/hidden with a visual indicator (e.g., lock icon or "System" badge).

## Why This Approach

**Approach A: Inline Detail View** was chosen over split-panel and modal alternatives because:

- Follows the existing dashboard tab pattern (list in content area, detail replaces it with back navigation)
- Simplest implementation — no complex split layouts or modal state management for long-form content
- Works well on all screen sizes
- Consistent with how settings and health tabs already present information

## Key Decisions

- **Tab-based, not sidebar-expandable:** Skills is a top-level tab like Chat Mirror, Settings, and System Health.
- **Active/inactive via filesystem:** Deactivation moves the skill folder to `public/.agents/inactive-skills/` rather than using a database flag. This keeps skills purely file-driven and means the Mastra Workspace naturally ignores inactive skills without code changes.
- **Confirmation modal for removal:** Uses the existing `Modal` component with `type: 'danger'`.
- **Markdown rendering with toggle:** Default to rendered HTML view of skill content, with a toggle to see raw Markdown source.
- **System skills are protected:** `find-skills`, `scheduling`, `self-update` cannot be deactivated or removed.
- **Install supports name + URL:** A single input field that accepts either a registry name or a GitHub URL.

## Scope

### In Scope

- New "Skills" tab in `Dashboard.tsx`
- API endpoints in `src/server.ts`: `GET /api/skills`, `POST /api/skills/toggle`, `DELETE /api/skills/:name`, `POST /api/skills/install`
- Read `SKILL.md` frontmatter (name, description) and body (content) from both `skills/` and `inactive-skills/` directories
- Filesystem operations: move folders between active/inactive dirs, delete folders
- System skill protection logic
- Skill install mechanism (backend runs `pnpx mastra skills add` or git clone equivalent)

### Out of Scope

- Editing skill content from the UI (read-only for now)
- Skill versioning or update checking
- Skill dependency management
- Drag-and-drop reordering

## Open Questions

None — all key decisions have been resolved through discussion.
