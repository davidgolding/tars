import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

function run(cmd: string, cwd: string): string {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 60_000 }).trim();
}

function readPackageVersion(root: string): string {
    const raw = readFileSync(join(root, 'package.json'), 'utf-8');
    return JSON.parse(raw).version;
}

function stripLeadingV(tag: string): string {
    return tag.startsWith('v') ? tag.slice(1) : tag;
}

export const checkForUpdateTool = createTool({
    id: 'check_for_update',
    description:
        'Check the origin git remote for new tagged releases or newer commits on origin/main, and optionally self-update (stop daemon → pull/checkout → install → build → restart daemon).',
    inputSchema: z.object({
        apply: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                'If true and an update is found, perform the full update cycle. If false (default), only check.',
            ),
        useLatestCommit: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                'If true, check for any newer commits on origin/main instead of tagged releases.',
            ),
    }),
    execute: async (input) => {
        const root = PROJECT_ROOT;
        let step = 'init';

        try {
            const currentVersion = readPackageVersion(root);

            // Fetch latest from origin
            step = 'git fetch';
            run('git fetch --tags origin', root);

            if (!input.useLatestCommit) {
                // --- Tag mode ---
                step = 'git tag --list';
                const tagOutput = run('git tag --list --sort=-version:refname', root);
                const tags = tagOutput.split('\n').filter(Boolean);

                if (tags.length === 0) {
                    return { updateAvailable: false, currentVersion, message: 'No tags found on remote.' };
                }

                const latestTag = tags[0];
                const latestVersion = stripLeadingV(latestTag);

                if (latestVersion === currentVersion) {
                    return { updateAvailable: false, currentVersion, latestTag };
                }

                if (!input.apply) {
                    return { updateAvailable: true, currentVersion, latestTag, latestVersion };
                }

                // Apply the update
                const log: string[] = [];

                step = 'daemon:stop';
                try {
                    log.push(run('pnpm run daemon:stop', root));
                } catch {
                    log.push('daemon:stop failed (daemon may not be running), continuing...');
                }

                step = 'git checkout';
                log.push(run(`git checkout ${latestTag}`, root));

                step = 'pnpm install';
                log.push(run('pnpm install --frozen-lockfile', root));

                step = 'pnpm run build';
                log.push(run('pnpm run build', root));

                step = 'daemon:start';
                log.push(run('pnpm run daemon:start', root));

                return {
                    updated: true,
                    previousVersion: currentVersion,
                    newVersion: latestVersion,
                    tag: latestTag,
                    log: log.join('\n'),
                };
            } else {
                // --- Commit mode ---
                step = 'git rev-parse HEAD';
                const currentCommit = run('git rev-parse HEAD', root);

                step = 'git rev-parse origin/main';
                const latestCommit = run('git rev-parse origin/main', root);

                if (currentCommit === latestCommit) {
                    return { updateAvailable: false, currentCommit: currentCommit.slice(0, 12) };
                }

                step = 'git log';
                const newCommitsRaw = run('git log --oneline HEAD..origin/main', root);
                const newCommits = newCommitsRaw.split('\n').filter(Boolean);

                if (!input.apply) {
                    return {
                        updateAvailable: true,
                        currentCommit: currentCommit.slice(0, 12),
                        latestCommit: latestCommit.slice(0, 12),
                        newCommits,
                    };
                }

                // Apply the update
                const log: string[] = [];

                step = 'daemon:stop';
                try {
                    log.push(run('pnpm run daemon:stop', root));
                } catch {
                    log.push('daemon:stop failed (daemon may not be running), continuing...');
                }

                step = 'git pull';
                log.push(run('git pull origin main', root));

                step = 'pnpm install';
                log.push(run('pnpm install --frozen-lockfile', root));

                step = 'pnpm run build';
                log.push(run('pnpm run build', root));

                step = 'daemon:start';
                log.push(run('pnpm run daemon:start', root));

                return {
                    updated: true,
                    previousCommit: currentCommit.slice(0, 12),
                    newCommit: latestCommit.slice(0, 12),
                    commitsApplied: newCommits.length,
                    log: log.join('\n'),
                };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const stdout = (error as any)?.stdout?.toString?.() ?? '';
            const stderr = (error as any)?.stderr?.toString?.() ?? '';
            return { error: message, step, stdout, stderr };
        }
    },
});
