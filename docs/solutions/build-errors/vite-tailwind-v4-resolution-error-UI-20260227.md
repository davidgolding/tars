---
module: UI Dashboard
date: 2026-02-27
problem_type: build_error
component: tooling
symptoms:
  - "Can't resolve 'tailwindcss' in src/ui/src/styles/index.css"
  - "Vite build fails with [plugin:@tailwindcss/vite:generate:serve]"
root_cause: incomplete_setup
resolution_type: dependency_update
severity: critical
tags: [vite, tailwind-v4, build-error, preact]
---

# Troubleshooting: Vite Tailwind v4 Resolution Error

## Problem
When implementing the new UI Dashboard with Tailwind CSS v4 and Vite, the build process failed to resolve the `tailwindcss` package, even though `@tailwindcss/vite` was installed and configured. This resulted in a broken UI with no styles and a Vite overlay showing resolution errors.

## Environment
- Module: UI Dashboard
- Affected Component: Build Tooling (Vite + Tailwind v4)
- Date: 2026-02-27

## Symptoms
- Observable error message in terminal and browser overlay: `[plugin:@tailwindcss/vite:generate:serve] Can't resolve 'tailwindcss' in '/Users/davidgolding/Development/tars/src/ui/src/styles' /Users/davidgolding/Development/tars/src/ui/src/styles/index.css`
- Interactive elements were missing or misaligned due to complete lack of CSS.

## What Didn't Work

**Attempted Solution 1:** Restarting the Vite dev server.
- **Why it failed:** The underlying dependency was missing from the `node_modules` and `package.json`, so a restart could not resolve it.

**Attempted Solution 2:** Checking the `@import "tailwindcss";` syntax.
- **Why it failed:** The syntax was correct for Tailwind v4, but the plugin couldn't find the source package to import from.

## Solution

The problem was identified as a missing core dependency. While Tailwind v4 uses a Vite plugin, it still requires the base `tailwindcss` package to be installed for the plugin to function correctly.

**Commands run to fix:**
```bash
# Add the missing core tailwindcss package
pnpm add tailwindcss
```

**Vite Configuration (`src/ui/vite.config.ts`):**
```typescript
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    preact(),
    tailwindcss(), // This plugin requires 'tailwindcss' to be installed separately
  ],
});
```

**CSS Entry Point (`src/ui/src/styles/index.css`):**
```css
@import "tailwindcss"; /* Requires the 'tailwindcss' package */
```

## Why This Works

1. **Root Cause**: Tailwind CSS v4 introduced a "CSS-first" configuration where the Vite plugin handles the processing. However, unlike previous versions where you might only need the CLI or a PostCSS plugin, the v4 Vite plugin explicitly looks for the `tailwindcss` core package to resolve the `@import "tailwindcss";` directive.
2. **Resolution**: Installing `tailwindcss` provided the necessary binaries and logic for the `@tailwindcss/vite` plugin to process the CSS and generate the utility classes.

## Prevention

- Always ensure both `@tailwindcss/vite` and `tailwindcss` are installed when setting up a new Tailwind v4 project.
- Check `package.json` dependencies if Vite reports resolution errors for standard CSS imports.
- Use `pnpm list tailwindcss` to verify the package is accessible in the project root.

## Related Issues

No related issues documented yet.
