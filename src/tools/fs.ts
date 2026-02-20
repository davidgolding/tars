import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { ToolResponse } from './time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../../');

/**
 * Validates that a path stays within the project root.
 */
function validatePath(path: string): string {
    const fullPath = resolve(ROOT_DIR, path);
    if (!fullPath.startsWith(ROOT_DIR)) {
        throw new Error('Access denied: Path is outside project root.');
    }
    return fullPath;
}

export function readFileTool(path: string): ToolResponse {
    try {
        const fullPath = validatePath(path);
        const content = readFileSync(fullPath, 'utf8');
        return {
            result: `Content of ${path}:\n\n${content}`
        };
    } catch (err: any) {
        return {
            error: `Failed to read file: ${err.message}`
        };
    }
}

export function writeFileTool(path: string, content: string): ToolResponse {
    try {
        const fullPath = validatePath(path);
        writeFileSync(fullPath, content, 'utf8');
        return {
            result: `Successfully wrote to ${path}`
        };
    } catch (err: any) {
        return {
            error: `Failed to write file: ${err.message}`
        };
    }
}

export function listFilesTool(path: string = '.'): ToolResponse {
    try {
        const fullPath = validatePath(path);
        const files = readdirSync(fullPath);
        const formatted = files.map(f => {
            const stats = lstatSync(join(fullPath, f));
            return stats.isDirectory() ? `${f}/` : f;
        }).join('\n');

        return {
            result: `Files in ${path || '.'}:\n${formatted}`
        };
    } catch (err: any) {
        return {
            error: `Failed to list files: ${err.message}`
        };
    }
}
