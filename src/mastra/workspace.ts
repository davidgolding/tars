import { Workspace, LocalFilesystem, LocalSandbox } from '@mastra/core/workspace';
import dotenv from 'dotenv';

dotenv.config();

export const WORKSPACE_PATH = process.env.WORKSPACE_PATH!;

const allowedPathsStr = process.env.WORKSPACE_ALLOWED_PATHS || '';
const allowedPaths = allowedPathsStr.split(',').map(p => p.trim()).filter(p => p.length > 0);

export const filesystem = new LocalFilesystem({
    basePath: WORKSPACE_PATH,
    ...(allowedPaths.length > 0 ? { allowedPaths } : {})
});

export const sandbox = new LocalSandbox({
    workingDirectory: WORKSPACE_PATH,
});

export const workspace = new Workspace({
    filesystem: filesystem,
    sandbox: sandbox,
    skills: ['/.agents/skills', '/skills'],
    bm25: true,
    tools: {
        mastra_workspace_execute_command: {
            enabled: false
        }
    }
});
