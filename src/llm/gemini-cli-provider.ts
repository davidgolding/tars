import { spawnSync } from 'node:child_process';
import { LLMProvider } from './provider.js';

/**
 * Executes the 'gemini' CLI tool locally.
 */
export class GeminiCLIProvider implements LLMProvider {
    async generateResponse(prompt: string): Promise<string> {
        try {
            // Using spawnSync to match existing reliable behavior
            const result = spawnSync('gemini', ['-o', 'text'], {
                input: prompt,
                encoding: 'utf-8',
                env: { ...process.env, TERM: 'dumb', CI: 'true' }
            });

            if (result.stderr && result.stderr.length > 0) {
                const stderrStr = result.stderr.toString();
                // Suppress known non-error logs
                if (!stderrStr.includes('Skill conflict detected') && !stderrStr.includes('Loaded cached credentials')) {
                    console.error(`[GeminiCLI] stderr: ${stderrStr}`);
                }
            }

            if (result.error) throw result.error;
            if (result.status !== 0) {
                throw new Error(`gemini CLI exited with code ${result.status}`);
            }

            return result.stdout?.trim() || '';
        } catch (err: any) {
            console.error('[GeminiCLI] Execution error:', err);
            throw err;
        }
    }
}
