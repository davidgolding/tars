import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkForUpdateTool } from './update.js';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
    readFileSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const mockedExecSync = vi.mocked(execSync);
const mockedReadFileSync = vi.mocked(readFileSync);

function setupPackageJson(version: string) {
    mockedReadFileSync.mockReturnValue(JSON.stringify({ version }));
}

function setupExecSync(responses: Record<string, string>) {
    mockedExecSync.mockImplementation((cmd: string) => {
        for (const [pattern, response] of Object.entries(responses)) {
            if (cmd.includes(pattern)) return response;
        }
        return '';
    });
}

describe('check_for_update tool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('tag mode (default)', () => {
        it('should report no update when no tags exist', async () => {
            setupPackageJson('1.0.0');
            setupExecSync({
                'git fetch': '',
                'git tag --list': '',
            });

            const result = await checkForUpdateTool.execute!(
                { apply: false, useLatestCommit: false },
                {} as any,
            );

            expect(result).toEqual({
                updateAvailable: false,
                currentVersion: '1.0.0',
                message: 'No tags found on remote.',
            });
        });

        it('should report no update when latest tag matches current version', async () => {
            setupPackageJson('1.0.0');
            setupExecSync({
                'git fetch': '',
                'git tag --list': 'v1.0.0\nv0.9.0\n',
            });

            const result = await checkForUpdateTool.execute!(
                { apply: false, useLatestCommit: false },
                {} as any,
            );

            expect(result).toEqual({
                updateAvailable: false,
                currentVersion: '1.0.0',
                latestTag: 'v1.0.0',
            });
        });

        it('should report update available when newer tag exists (check only)', async () => {
            setupPackageJson('1.0.0');
            setupExecSync({
                'git fetch': '',
                'git tag --list': 'v1.1.0\nv1.0.0\n',
            });

            const result = await checkForUpdateTool.execute!(
                { apply: false, useLatestCommit: false },
                {} as any,
            );

            expect(result).toEqual({
                updateAvailable: true,
                currentVersion: '1.0.0',
                latestTag: 'v1.1.0',
                latestVersion: '1.1.0',
            });
        });

        it('should run the full update sequence when apply is true', async () => {
            setupPackageJson('1.0.0');
            const commands: string[] = [];
            mockedExecSync.mockImplementation((cmd: string) => {
                commands.push(cmd as string);
                if ((cmd as string).includes('git tag --list')) return 'v1.1.0\nv1.0.0\n';
                return '';
            });

            const result: any = await checkForUpdateTool.execute!(
                { apply: true, useLatestCommit: false },
                {} as any,
            );

            expect(result.updated).toBe(true);
            expect(result.previousVersion).toBe('1.0.0');
            expect(result.newVersion).toBe('1.1.0');
            expect(result.tag).toBe('v1.1.0');

            expect(commands).toContain('git fetch --tags origin');
            expect(commands.some(c => c.includes('daemon:stop'))).toBe(true);
            expect(commands).toContain('git checkout v1.1.0');
            expect(commands).toContain('pnpm install --frozen-lockfile');
            expect(commands.some(c => c.includes('pnpm run build'))).toBe(true);
            expect(commands.some(c => c.includes('daemon:start'))).toBe(true);
        });

        it('should handle tags without v prefix', async () => {
            setupPackageJson('1.0.0');
            setupExecSync({
                'git fetch': '',
                'git tag --list': '1.0.0\n',
            });

            const result = await checkForUpdateTool.execute!(
                { apply: false, useLatestCommit: false },
                {} as any,
            );

            expect(result).toEqual({
                updateAvailable: false,
                currentVersion: '1.0.0',
                latestTag: '1.0.0',
            });
        });
    });

    describe('commit mode (useLatestCommit: true)', () => {
        it('should report no update when HEAD matches origin/main', async () => {
            setupPackageJson('1.0.0');
            setupExecSync({
                'git fetch': '',
                'git rev-parse HEAD': 'abc123def456',
                'git rev-parse origin/main': 'abc123def456',
            });

            const result = await checkForUpdateTool.execute!(
                { apply: false, useLatestCommit: true },
                {} as any,
            );

            expect(result).toEqual({
                updateAvailable: false,
                currentCommit: 'abc123def456',
            });
        });

        it('should report update available when origin/main is ahead', async () => {
            setupPackageJson('1.0.0');
            setupExecSync({
                'git fetch': '',
                'git rev-parse HEAD': 'aaa111222333',
                'git rev-parse origin/main': 'bbb444555666',
                'git log --oneline': 'bbb4445 feat: new thing\nccc7778 fix: bug',
            });

            const result: any = await checkForUpdateTool.execute!(
                { apply: false, useLatestCommit: true },
                {} as any,
            );

            expect(result.updateAvailable).toBe(true);
            expect(result.currentCommit).toBe('aaa111222333');
            expect(result.latestCommit).toBe('bbb444555666');
            expect(result.newCommits).toEqual([
                'bbb4445 feat: new thing',
                'ccc7778 fix: bug',
            ]);
        });

        it('should run git pull when apply is true in commit mode', async () => {
            setupPackageJson('1.0.0');
            const commands: string[] = [];
            mockedExecSync.mockImplementation((cmd: string) => {
                commands.push(cmd as string);
                if ((cmd as string).includes('git rev-parse HEAD')) return 'aaa111';
                if ((cmd as string).includes('git rev-parse origin/main')) return 'bbb222';
                if ((cmd as string).includes('git log --oneline')) return 'bbb222 feat: stuff';
                return '';
            });

            const result: any = await checkForUpdateTool.execute!(
                { apply: true, useLatestCommit: true },
                {} as any,
            );

            expect(result.updated).toBe(true);
            expect(commands.some(c => c.includes('daemon:stop'))).toBe(true);
            expect(commands).toContain('git pull origin main');
            expect(commands).toContain('pnpm install --frozen-lockfile');
            expect(commands.some(c => c.includes('pnpm run build'))).toBe(true);
            expect(commands.some(c => c.includes('daemon:start'))).toBe(true);
        });
    });

    describe('error handling', () => {
        it('should return error details when a step fails', async () => {
            setupPackageJson('1.0.0');
            mockedExecSync.mockImplementation((cmd: string) => {
                if ((cmd as string).includes('git fetch')) {
                    const err = new Error('fatal: could not read remote');
                    (err as any).stderr = Buffer.from('fatal: could not read remote');
                    throw err;
                }
                return '';
            });

            const result: any = await checkForUpdateTool.execute!(
                { apply: false, useLatestCommit: false },
                {} as any,
            );

            expect(result.error).toContain('fatal: could not read remote');
            expect(result.step).toBe('git fetch');
        });
    });
});
