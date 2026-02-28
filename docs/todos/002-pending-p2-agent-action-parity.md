---
status: pending
priority: p2
issue_id: 002
tags: [architecture, agent-native]
dependencies: []
---

# Problem Statement
The new UI introduces system management actions (like restarting the daemon and updating configuration), but these actions are not available to the Tars agent itself. This violates the Agent-Native Architecture principle of "Action Parity."

# Findings
- The UI can trigger a system restart via `POST /api/system/restart`.
- There is no corresponding Mastra tool that allows the agent to trigger a restart or update its own settings.

# Proposed Solutions

## Option 1: Create System Management Tools
- **Description:** Add `restartSystemTool` and `updateConfigTool` to the `builtinTools` array in `src/mastra/agents/tars.ts`.
- **Pros:** Restores action parity, allowing the user to say "Tars, restart yourself" via Signal.
- **Cons:** Requires careful system prompt tuning to ensure the agent doesn't restart itself randomly.
- **Effort:** Medium
- **Risk:** Low

# Technical Details
- Files: `src/mastra/agents/tars.ts`, `src/mastra/tools/`

# Acceptance Criteria
- [ ] Agent has a tool to trigger a system restart.
- [ ] Tool is documented in the agent's system prompt.

# Work Log
- ${new Date().toISOString().split('T')[0]}: Finding created during initial UI review.

# Resources
- Agent-Native Reviewer Guidelines.