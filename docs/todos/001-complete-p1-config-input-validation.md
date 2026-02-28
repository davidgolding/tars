---
status: complete
priority: p1
issue_id: 001
tags: [security, input-validation]
dependencies: []
---

# Problem Statement
The `/api/config` endpoint in `src/server.ts` blindly accepts `req.body` and writes the values directly to the `.env` file without schema validation or sanitization. This is a critical risk as it could lead to configuration injection or system instability if malformed data is passed.

# Findings
- `src/server.ts`: The `POST /api/config` endpoint iterates over predefined keys, but the values from `req.body` are not validated against expected formats (e.g., E.164 phone numbers, valid API key formats).

# Proposed Solutions

## Option 1: Use Zod for Request Validation
- **Description:** Implement a Zod schema to strictly validate the incoming `req.body` before processing.
- **Pros:** Strong typing, aligns with existing `setup.ts` patterns which already use Zod for phone number validation.
- **Cons:** Adds a minor dependency to the Express route handler.
- **Effort:** Small
- **Risk:** Low

## Option 2: Manual Type Checking
- **Description:** Add manual `typeof` and regex checks for each expected field.
- **Pros:** No extra libraries needed.
- **Cons:** Verbose and prone to developer error.
- **Effort:** Small
- **Risk:** Medium

# Technical Details
- File: `src/server.ts`
- Affected Route: `POST /api/config`

# Acceptance Criteria
- [ ] Zod schema (or equivalent) defined for the config payload.
- [ ] Endpoint rejects invalid payloads with a 400 status code.
- [ ] Valid payloads are written correctly to the `.env` file.

# Work Log
- ${new Date().toISOString().split('T')[0]}: Finding created during initial UI review.

# Resources
- Existing Zod usage in `src/setup.ts`.