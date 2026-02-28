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
import { getSetting, initDb, updateSetting, dbPath } from './db.js';
import { uiEvents } from './signal_events.js';
import { checkSignalStatus, startSignalListener, stopSignalListener } from './signal.js';
import { processAgentMessage } from './mastra/service.js';
import Database from 'better-sqlite3';

dotenv.config();

const phoneSchema = z.string().regex(/^\+\d{10,15}$/, "Must be an E.164 formatted phone number (e.g., +1234567890)");
const chatSchema = z.object({ content: z.string().min(1).max(2000) });

const configSchema = z.object({
    name: z.string().min(1).optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    botNumber: phoneSchema,
    targetNumber: phoneSchema,
    promptsPath: z.string().optional(),
});

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

    app.listen(PORT, () => {
        console.log(`[Tars UI] Server running at http://localhost:${PORT}`);
    });
}

createServer().catch(err => {
    console.error('>>> FATAL SERVER ERROR:', err);
});
