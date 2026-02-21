import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../../../');

function validatePath(path: string): string {
    const fullPath = resolve(ROOT_DIR, path);
    if (!fullPath.startsWith(ROOT_DIR)) {
        throw new Error('Access denied: Path is outside project root.');
    }
    return fullPath;
}

export const readFileTool = createTool({
    id: 'read_file',
    description: 'Reads a file from the project directory.',
    inputSchema: z.object({
        path: z.string().describe('Relative path to the file within the project root'),
    }),
    execute: async (inputData) => {
        const fullPath = validatePath(inputData.path);
        const content = readFileSync(fullPath, 'utf8');
        return { result: `Content of ${inputData.path}:\n\n${content}` };
    },
});

export const writeFileTool = createTool({
    id: 'write_file',
    description: 'Writes content to a file in the project directory.',
    inputSchema: z.object({
        path: z.string().describe('Relative path to the file within the project root'),
        content: z.string().describe('Content to write to the file'),
    }),
    execute: async (inputData) => {
        const fullPath = validatePath(inputData.path);
        writeFileSync(fullPath, inputData.content, 'utf8');
        return { result: `Successfully wrote to ${inputData.path}` };
    },
});

export const listFilesTool = createTool({
    id: 'list_files',
    description: 'Lists files in a directory within the project.',
    inputSchema: z.object({
        path: z.string().optional().describe('Relative path to directory (defaults to project root)'),
    }),
    execute: async (inputData) => {
        const targetPath = inputData.path ?? '.';
        const fullPath = validatePath(targetPath);
        const files = readdirSync(fullPath);
        const formatted = files.map(f => {
            const stats = lstatSync(join(fullPath, f));
            return stats.isDirectory() ? `${f}/` : f;
        }).join('\n');
        return { result: `Files in ${targetPath}:\n${formatted}` };
    },
});
