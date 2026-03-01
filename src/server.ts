console.log('>>> SERVER STARTING');
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { spawn, exec } from 'child_process';
import { z } from 'zod';
import { getSetting, initDb, updateSetting, dbPath, getPluginConfig } from './db.js';
import { uiEvents } from './signal_events.js';
import { checkSignalStatus, startSignalListener, stopSignalListener } from './signal.js';
import { processAgentMessage } from './mastra/service.js';
import { channelManager } from './plugins/channel-manager.js';
import Database from 'better-sqlite3';

dotenv.config();

const phoneSchema = z.string().regex(/^\+\d{10,15}$/, "Must be an E.164 formatted phone number (e.g., +1234567890)");
const chatSchema = z.object({ content: z.string().min(1).max(2000) });
const pluginIdSchema = z.string().regex(/^[a-z0-9-]+$/, "Plugin ID must be lowercase alphanumeric with dashes");

const configSchema = z.object({
    name: z.string().min(1).optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    botNumber: phoneSchema,
    targetNumber: phoneSchema,
    promptsPath: z.string().optional(),
});

// Authentication middleware for plugin management
// In production, this should use a proper auth system. For now, require an API key.
const requirePluginAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    const expectedKey = process.env.TARS_ADMIN_API_KEY;
    
    // If no admin key configured, require local requests only
    if (!expectedKey) {
        const clientIp = req.ip || req.socket.remoteAddress || '';
        const isLocal = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
        if (!isLocal) {
            return res.status(401).json({ error: 'Plugin management requires authentication. Set TARS_ADMIN_API_KEY env variable.' });
        }
        return next();
    }
    
    if (!apiKey || apiKey !== expectedKey) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    next();
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.TARS_PORT || 5827;

async function createServer() {
    console.log('>>> createServer() called');
    try {
        initDb();
    } catch (e) {
        console.error('>>> initDb failed:', e);
    }

    const app = express();
    app.use(express.json());

    // API Router
    const apiRouter = express.Router();

    apiRouter.get('/status', async (req, res) => {
        try {
            const bootstrapped = getSetting('bootstrapped');
            const botNumber = getSetting('BOT_SIGNAL_NUMBER') || process.env.BOT_SIGNAL_NUMBER;
            const targetNumber = getSetting('TARGET_SIGNAL_NUMBER') || process.env.TARGET_SIGNAL_NUMBER;
            const signalOnline = await checkSignalStatus();
            res.json({
                bootstrapped: !!bootstrapped,
                timestamp: bootstrapped,
                botNumber,
                targetNumber,
                signalOnline
            });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.post('/config', async (req, res) => {
        try {
            const validation = configSchema.safeParse(req.body);
            if (!validation.success) {
                return res.status(400).json({ error: 'Invalid configuration', details: validation.error.format() });
            }

            const config = validation.data;
            const envPath = path.join(process.cwd(), '.env');
            let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

            const updates: Record<string, string | undefined> = {
                'BOT_SIGNAL_NUMBER': config.botNumber,
                'TARGET_SIGNAL_NUMBER': config.targetNumber,
                'LLM_API_KEY': config.apiKey,
                'LLM_API_MODEL': config.model || 'google/gemini-flash-latest',
                'LLM_PROVIDER': config.apiKey ? 'gemini-api' : 'gemini-cli',
                'AGENT_PROMPTS_PATH': config.promptsPath || 'agent/'
            };

            for (const [key, value] of Object.entries(updates)) {
                if (value === undefined) continue;
                const regex = new RegExp(`^${key}=.*`, 'm');
                if (envContent.match(regex)) {
                    envContent = envContent.replace(regex, `${key}=${value}`);
                } else {
                    envContent += `\n${key}=${value}`;
                }
            }

            fs.writeFileSync(envPath, envContent.trim() + '\n');
            if (config.name) {
                updateSetting('identity_context', `- **Name:** ${config.name}\n- **Role:** Personal Assistant\n`);
            }

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.post('/bootstrap/finalize', (req, res) => {
        try {
            const timestamp = new Date().toISOString();
            updateSetting('bootstrapped', timestamp);
            res.json({ success: true, timestamp });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.get('/signal/link', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const signal = spawn('signal-cli', ['link', '-n', 'Tars-Dashboard']);

        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 15000);

        const handleSignalOutput = (output: string) => {
            const match = output.match(/sgnl:\/\/\S+/);
            if (match) res.write(`data: ${JSON.stringify({ type: 'uri', value: match[0] })}\n\n`);
            if (output.includes('Device linked')) res.write(`data: ${JSON.stringify({ type: 'success' })}\n\n`);
        };

        signal.stdout.on('data', (data) => handleSignalOutput(data.toString()));
        signal.stderr.on('data', (data) => handleSignalOutput(data.toString()));

        signal.on('close', (code) => {
            clearInterval(heartbeat);
            if (code === 0) {
                res.write(`data: ${JSON.stringify({ type: 'success' })}\n\n`);
            } else {
                res.write(`data: ${JSON.stringify({ type: 'error', code })}\n\n`);
            }
            res.end();
        });

        req.on('close', () => {
            signal.kill();
            clearInterval(heartbeat);
        });
    });

    apiRouter.post('/signal/daemon/start', async (req, res) => {
        // Re-read .env so values written by the wizard during this session are visible
        dotenv.config({ override: true });
        const botNumber = getSetting('BOT_SIGNAL_NUMBER') || process.env.BOT_SIGNAL_NUMBER;
        const targetNumber = getSetting('TARGET_SIGNAL_NUMBER') || process.env.TARGET_SIGNAL_NUMBER;
        const targetGroup = process.env.TARGET_SIGNAL_GROUP;

        if (!botNumber || !targetNumber) {
            return res.status(400).json({ error: 'BOT_SIGNAL_NUMBER and TARGET_SIGNAL_NUMBER must be configured.' });
        }

        res.json({ success: true });

        startSignalListener(botNumber, targetNumber, targetGroup, async (text, sender, groupId) => {
            await processAgentMessage({ text, sender, groupId, origin: 'signal' });
        }).catch(err => console.error('[Signal] Daemon start failed:', err));
    });

    apiRouter.post('/signal/daemon/stop', async (req, res) => {
        try {
            await stopSignalListener();
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.get('/chat/history', (req, res) => {
        try {
            const db = new Database(dbPath);
            const messages = db.prepare('SELECT id, role, content, createdAt FROM mastra_messages ORDER BY createdAt ASC LIMIT 100').all();
            res.json(messages);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.post('/chat/send', async (req, res) => {
        try {
            const { content } = chatSchema.parse(req.body);
            const targetNumber = getSetting('TARGET_SIGNAL_NUMBER') || process.env.TARGET_SIGNAL_NUMBER;

            if (!targetNumber) {
                return res.status(400).json({ error: 'Target number not configured' });
            }

            // We process this asynchronously so the API can return quickly, 
            // the UI will get updates via SSE
            processAgentMessage({
                text: content,
                sender: targetNumber,
                origin: 'ui'
            }).catch(err => {
                console.error('[API] Error in background message processing:', err);
            });

            res.json({ success: true });
        } catch (err) {
            if (err instanceof z.ZodError) {
                res.status(400).json({ error: 'Invalid message', details: err.format() });
            } else {
                res.status(500).json({ error: (err as Error).message });
            }
        }
    });

    apiRouter.get('/chat/events', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const onMessage = (message: any) => {
            res.write(`data: ${JSON.stringify(message)}\n\n`);
        };

        uiEvents.on('message', onMessage);

        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 30000);

        req.on('close', () => {
            uiEvents.off('message', onMessage);
            clearInterval(heartbeat);
        });
    });

    apiRouter.post('/daemon/setup', async (req, res) => {
        try {
            const cwd = process.cwd();
            const nodePath = process.execPath;
            const entryPath = path.join(cwd, 'dist', 'index.js');
            const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
            const logsDir = path.join(os.homedir(), 'Library', 'Logs', 'tars');

            // Build if dist/index.js doesn't exist
            if (!fs.existsSync(entryPath)) {
                await new Promise<void>((resolve, reject) => {
                    exec('pnpm run build', { cwd }, (err) => err ? reject(err) : resolve());
                });
            }

            fs.mkdirSync(agentsDir, { recursive: true });
            fs.mkdirSync(logsDir, { recursive: true });

            const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.davidgolding.tars</string>

    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${entryPath}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${cwd}</string>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>${path.join(logsDir, 'output.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(logsDir, 'error.log')}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>`;

            const plistPath = path.join(agentsDir, 'com.davidgolding.tars.plist');
            fs.writeFileSync(plistPath, plistContent);

            // Unload any existing + load fresh
            await new Promise<void>((resolve) => {
                exec(`launchctl unload "${plistPath}" 2>/dev/null; launchctl load "${plistPath}"`, (err) => {
                    if (err) console.error('[Daemon] launchctl load failed:', err);
                    else console.log('[Daemon] Loaded launchd plist');
                    resolve();
                });
            });

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.post('/system/restart', (req, res) => {
        res.json({ success: true, message: 'Restarting system...' });
        setTimeout(() => {
            exec('pnpm run daemon:restart', (err, stdout) => {
                if (err) console.error('[System] Restart failed:', err);
                else console.log('[System] Restart output:', stdout);
            });
        }, 1000);
    });

    // --- Skills Management ---

    const SYSTEM_SKILLS = ['find-skills', 'scheduling', 'self-update'];
    const WORKSPACE_PATH = process.env.WORKSPACE_PATH || path.join(process.cwd(), 'public');
    const SKILLS_DIR = path.join(WORKSPACE_PATH, '.agents', 'skills');
    const INACTIVE_SKILLS_DIR = path.join(WORKSPACE_PATH, '.agents', 'inactive-skills');

    function parseSkillMd(filePath: string, folderId: string): { name: string; description: string; content: string } {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
            if (!match) return { name: folderId, description: '', content: raw };

            const frontmatter = match[1];
            const content = match[2].trim();

            const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
            const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

            return {
                name: nameMatch ? nameMatch[1].trim() : folderId,
                description: descMatch ? descMatch[1].trim() : '',
                content,
            };
        } catch {
            return { name: folderId, description: '', content: '' };
        }
    }

    function isValidSkillName(name: string): boolean {
        return !!name && !name.includes('/') && !name.includes('\\') && !name.includes('..') && !name.includes('\0');
    }

    function readSkillsFromDir(dir: string, active: boolean) {
        fs.mkdirSync(dir, { recursive: true });
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory())
            .map(e => {
                const skillPath = path.join(dir, e.name, 'SKILL.md');
                const parsed = parseSkillMd(skillPath, e.name);
                return {
                    id: e.name,
                    name: parsed.name,
                    description: parsed.description,
                    content: parsed.content,
                    active,
                    isSystem: SYSTEM_SKILLS.includes(e.name),
                };
            });
    }

    apiRouter.get('/skills', (req, res) => {
        try {
            const active = readSkillsFromDir(SKILLS_DIR, true);
            const inactive = readSkillsFromDir(INACTIVE_SKILLS_DIR, false);
            const skills = [...active, ...inactive].sort((a, b) => a.id.localeCompare(b.id));
            res.json({ skills });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.post('/skills/:name/toggle', (req, res) => {
        try {
            const { name } = req.params;
            if (!isValidSkillName(name)) {
                return res.status(400).json({ error: 'Invalid skill name' });
            }
            if (SYSTEM_SKILLS.includes(name)) {
                return res.status(403).json({ error: 'Cannot toggle a system skill' });
            }

            const activePath = path.join(SKILLS_DIR, name);
            const inactivePath = path.join(INACTIVE_SKILLS_DIR, name);

            if (fs.existsSync(activePath)) {
                fs.mkdirSync(INACTIVE_SKILLS_DIR, { recursive: true });
                fs.renameSync(activePath, inactivePath);
                res.json({ success: true, active: false });
            } else if (fs.existsSync(inactivePath)) {
                fs.mkdirSync(SKILLS_DIR, { recursive: true });
                fs.renameSync(inactivePath, activePath);
                res.json({ success: true, active: true });
            } else {
                res.status(404).json({ error: 'Skill not found' });
            }
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.delete('/skills/:name', (req, res) => {
        try {
            const { name } = req.params;
            if (!isValidSkillName(name)) {
                return res.status(400).json({ error: 'Invalid skill name' });
            }
            if (SYSTEM_SKILLS.includes(name)) {
                return res.status(403).json({ error: 'Cannot remove a system skill' });
            }

            const activePath = path.join(SKILLS_DIR, name);
            const inactivePath = path.join(INACTIVE_SKILLS_DIR, name);

            if (fs.existsSync(activePath)) {
                fs.rmSync(activePath, { recursive: true, force: true });
            } else if (fs.existsSync(inactivePath)) {
                fs.rmSync(inactivePath, { recursive: true, force: true });
            } else {
                return res.status(404).json({ error: 'Skill not found' });
            }

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    const installSchema = z.object({ source: z.string().min(1) });

    apiRouter.post('/skills/install', async (req, res) => {
        try {
            const { source } = installSchema.parse(req.body);

            // Check for existing skill with same name (basic slug extraction)
            const slug = source.split('/').pop()?.replace(/\.git$/, '') || source;
            const activePath = path.join(SKILLS_DIR, slug);
            const inactivePath = path.join(INACTIVE_SKILLS_DIR, slug);

            if (fs.existsSync(activePath) || fs.existsSync(inactivePath)) {
                return res.status(409).json({ error: `Skill "${slug}" already exists. Remove it first to reinstall.` });
            }

            // Run install command
            await new Promise<void>((resolve, reject) => {
                const child = exec(
                    `npx -y @anthropic-ai/skills add ${source}`,
                    { cwd: WORKSPACE_PATH, timeout: 60000 },
                    (err, stdout, stderr) => {
                        if (err) {
                            // Clean up partial install
                            if (fs.existsSync(activePath)) {
                                fs.rmSync(activePath, { recursive: true, force: true });
                            }
                            reject(new Error(stderr || err.message));
                        } else {
                            resolve();
                        }
                    }
                );
            });

            // Read the newly installed skill
            const skillPath = path.join(SKILLS_DIR, slug, 'SKILL.md');
            const parsed = parseSkillMd(skillPath, slug);

            res.json({
                success: true,
                skill: { id: slug, name: parsed.name, description: parsed.description },
            });
        } catch (err) {
            if (err instanceof z.ZodError) {
                res.status(400).json({ error: 'Invalid request', details: err.format() });
            } else {
                res.status(500).json({ error: (err as Error).message });
            }
        }
    });

    // Plugin API endpoints
    const PLUGINS_DIR = path.join(WORKSPACE_PATH, '.agents', 'plugins');

    apiRouter.get('/plugins', (req, res) => {
        try {
            const plugins = channelManager.listPlugins();
            
            // Enrich with status and schema
            const enrichedPlugins = plugins.map(p => {
                const status = channelManager.getPluginStatus(p.id);
                let schema = null;
                const schemaPath = path.join(PLUGINS_DIR, p.id, 'schema.json');
                if (fs.existsSync(schemaPath)) {
                    try {
                        schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
                    } catch {}
                }
                return { ...p, status, schema };
            });
            
            res.json({ plugins: enrichedPlugins });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.post('/plugins/:id/toggle', requirePluginAuth, async (req, res) => {
        try {
            const id = req.params.id as string;
            const validation = pluginIdSchema.safeParse(id);
            if (!validation.success) {
                return res.status(400).json({ error: 'Invalid plugin ID' });
            }
            
            const plugin = channelManager.getPlugin(id);
            
            if (!plugin) {
                return res.status(404).json({ error: 'Plugin not found' });
            }

            const status = channelManager.getPluginStatus(id);
            if (status.online) {
                await channelManager.stopPlugin(id);
                res.json({ success: true, enabled: false });
            } else {
                await channelManager.startPlugin(id);
                res.json({ success: true, enabled: true });
            }
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.get('/plugins/:id/config', requirePluginAuth, (req, res) => {
        try {
            const id = req.params.id as string;
            const validation = pluginIdSchema.safeParse(id);
            if (!validation.success) {
                return res.status(400).json({ error: 'Invalid plugin ID' });
            }
            
            const config = getPluginConfig(id) || {};
            res.json({ config });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.put('/plugins/:id/config', requirePluginAuth, async (req, res) => {
        try {
            const id = req.params.id as string;
            const validation = pluginIdSchema.safeParse(id);
            if (!validation.success) {
                return res.status(400).json({ error: 'Invalid plugin ID' });
            }
            
            const { config } = req.body;
            
            if (!config || typeof config !== 'object') {
                return res.status(400).json({ error: 'Invalid config' });
            }

            await channelManager.updatePluginConfig(id, config);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    apiRouter.post('/plugins/install', requirePluginAuth, async (req, res) => {
        try {
            const { source } = req.body;
            if (!source) {
                return res.status(400).json({ error: 'Source URL is required' });
            }

            // Strict GitHub URL validation
            const githubUrlSchema = z.string()
                .url()
                .regex(/^https:\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-._]+$/);
            
            const urlValidation = githubUrlSchema.safeParse(source);
            if (!urlValidation.success) {
                return res.status(400).json({ error: 'Invalid GitHub URL format. Must be https://github.com/owner/repo' });
            }

            // Extract repo info from URL
            const repoMatch = source.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
            if (!repoMatch) {
                return res.status(400).json({ error: 'Invalid GitHub URL' });
            }

            const [, owner, repo] = repoMatch;
            const pluginId = repo.toLowerCase().replace(/[^a-z0-9-]/g, '-');
            const targetDir = path.join(PLUGINS_DIR, pluginId);

            if (fs.existsSync(targetDir)) {
                return res.status(409).json({ error: `Plugin "${pluginId}" already installed` });
            }

            // Clone the repo with timeout
            fs.mkdirSync(targetDir, { recursive: true });
            await new Promise<void>((resolve, reject) => {
                const git = spawn('git', ['clone', '--depth', '1', source, targetDir]);
                const timeout = setTimeout(() => {
                    git.kill();
                    reject(new Error('Git clone timed out after 60 seconds'));
                }, 60000);
                git.on('close', (code) => {
                    clearTimeout(timeout);
                    if (code === 0) resolve();
                    else reject(new Error(`git clone failed with code ${code}`));
                });
            });

            // Check for package.json and install deps with --ignore-scripts for security
            const pkgJsonPath = path.join(targetDir, 'package.json');
            if (fs.existsSync(pkgJsonPath)) {
                await new Promise<void>((resolve, reject) => {
                    const npm = spawn('npm', ['install', '--ignore-scripts'], { cwd: targetDir });
                    const timeout = setTimeout(() => {
                        npm.kill();
                        reject(new Error('npm install timed out after 120 seconds'));
                    }, 120000);
                    npm.on('close', (code) => {
                        clearTimeout(timeout);
                        if (code === 0) resolve();
                        else reject(new Error(`npm install failed with code ${code}`));
                    });
                });
            }

            // Reload plugins
            await channelManager.loadPlugins();

            res.json({ success: true, plugin: { id: pluginId, name: pluginId } });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    app.use('/api', apiRouter);

    let vite: any;
    if (!isProd) {
        console.log('>>> Initializing Vite...');
        try {
            vite = await createViteServer({
                server: { middlewareMode: true },
                appType: 'custom',
                root: path.resolve(__dirname, 'ui')
            });
            app.use(vite.middlewares);
            console.log('>>> Vite initialized');
        } catch (e) {
            console.error('>>> Vite initialization failed:', e);
        }
    } else {
        app.use(express.static(path.resolve(__dirname, 'ui/dist/client')));
    }

    app.get(/^(?!\/api).+/, async (req, res, next) => {
        const url = req.originalUrl;
        try {
            let template;
            if (!isProd && vite) {
                template = fs.readFileSync(path.resolve(__dirname, 'ui/index.html'), 'utf-8');
                template = await vite.transformIndexHtml(url, template);
            } else {
                template = fs.readFileSync(path.resolve(__dirname, 'ui/dist/client/index.html'), 'utf-8');
            }
            res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
        } catch (e) {
            vite?.ssrFixStacktrace(e as Error);
            next(e);
        }
    });

    // Load channel plugins
    console.log('[Tars UI] Loading channel plugins...');
    await channelManager.loadPlugins();

    app.listen(PORT, () => {
        console.log(`[Tars UI] Server running at http://localhost:${PORT}`);
    });
}

createServer().catch(err => {
    console.error('>>> FATAL SERVER ERROR:', err);
});
