import { select, input, confirm } from '@inquirer/prompts';
import { GoogleGenAI } from '@google/genai';
import chalk from 'chalk';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const phoneSchema = z.string().regex(/^\+\d{10,15}$/, "Must be an E.164 formatted phone number (e.g., +1234567890)");

async function main() {
    console.log(chalk.bold.blue('\nWelcome to the Tars Configuration Wizard\n'));

    // 1. LLM Provider
    const provider = await select({
        message: 'Select the Model/auth provider:',
        choices: [
            { name: 'Google', value: 'google' },
            { name: 'OpenAI (Coming Soon)', value: 'openai', disabled: true },
            { name: 'Anthropic (Coming Soon)', value: 'anthropic', disabled: true },
            { name: 'Ollama (Coming Soon)', value: 'ollama', disabled: true },
            { name: 'MiniMax (Coming Soon)', value: 'minimax', disabled: true },
            { name: 'Moonshot (Coming Soon)', value: 'moonshot', disabled: true },
            { name: 'OpenRouter (Coming Soon)', value: 'openrouter', disabled: true },
        ],
    });

    // 2. Auth Method
    let llmProviderConfig = 'gemini-cli';
    let apiKey = '';

    if (provider === 'google') {
        const authMethod = await select({
            message: 'Select the Google auth method:',
            choices: [
                { name: 'Google Gemini API key', value: 'api' },
                { name: 'Google Gemini CLI Oauth', value: 'cli' },
                { name: 'Google Antigravity Oauth (Coming Soon)', value: 'antigravity', disabled: true },
            ],
        });

        if (authMethod === 'api') {
            apiKey = await input({
                message: 'Enter your Gemini API key:',
                validate: (value) => value.trim().length > 0 || 'API key is required',
            });
            llmProviderConfig = 'gemini-api';
        } else if (authMethod === 'cli') {
            console.log(chalk.gray('Using Gemini CLI for OAuth. Ensure it is configured via `gemini cert` if needed.'));
            llmProviderConfig = 'gemini-cli';
        }
    }

    // Dynamic Model Selection
    let modelList: { name: string, value: string }[] = [];
    if (apiKey) {
        console.log(chalk.cyan('Fetching available models from Google...'));
        try {
            const ai = new GoogleGenAI({ apiKey });
            const res = await ai.models.list();
            for await (const model of res) {
                if (model.name && model.name.startsWith('models/gemini')) {
                    const shortName = model.name.replace('models/', '');
                    modelList.push({ name: shortName, value: shortName });
                }
            }
        } catch (err) {
            console.log(chalk.yellow('Warning: Failed to fetch models dynamically. Using fallback list.'));
        }
    }

    if (modelList.length === 0) {
        modelList = [
            { name: 'gemini-3-flash-preview', value: 'gemini-3-flash-preview' },
            { name: 'gemini-3-pro-preview', value: 'gemini-3-pro-preview' },
            { name: 'gemini-2.5-flash', value: 'gemini-2.5-flash' },
            { name: 'gemini-2.5-pro', value: 'gemini-2.5-pro' },
            { name: 'gemini-2.0-flash', value: 'gemini-2.0-flash' },
        ];
    }

    modelList.push({ name: 'Other (type manually)', value: 'custom' });

    let selectedModel = await select({
        message: 'Select a Gemini model to use:',
        choices: modelList,
    });

    if (selectedModel === 'custom') {
        selectedModel = await input({
            message: 'Enter the exact model name (e.g., gemini-3-flash-preview):',
            validate: (value) => value.trim().length > 0 || 'Model name is required',
        });
    }

    let maxIterations = await input({
        message: 'Enter the maximum number of iterations before cutting off the model/API: ' + chalk.gray('(recommended: 35)'),
        validate: (value) => {
            const res = z.number().positive().safeParse(Number(value.trim()));
            return res.success || 'A number greater than 0 is required';
        }
    });

    // 3. Channel
    const channel = await select({
        message: 'Select a channel:',
        choices: [
            { name: 'Signal', value: 'signal' },
            { name: 'Telegram (Coming Soon)', value: 'telegram', disabled: true },
            { name: 'WhatsApp (Coming Soon)', value: 'whatsapp', disabled: true },
            { name: 'Discord (Coming Soon)', value: 'discord', disabled: true },
            { name: 'Google Chat (Coming Soon)', value: 'google_chat', disabled: true },
        ],
    });

    let botNumber = '';
    let targetNumber = '';
    let targetGroup = '';

    if (channel === 'signal') {
        // Check for signal-cli
        const signalCheck = spawnSync('which', ['signal-cli']);
        if (signalCheck.status !== 0) {
            console.log(chalk.yellow('\nWarning: signal-cli is not installed.'));
            const install = await confirm({ message: 'Would you like to install it now via Homebrew?' });
            if (install) {
                console.log(chalk.cyan('Installing signal-cli...'));
                spawnSync('brew', ['install', 'signal-cli'], { stdio: 'inherit' });
            } else {
                console.log(chalk.red('Cannot proceed without signal-cli.'));
                process.exit(1);
            }
        }

        botNumber = await input({
            message: 'Enter the Signal bot number (e.g., +1234567890):',
            validate: (val) => {
                const res = phoneSchema.safeParse(val);
                return res.success || res.error.issues[0].message;
            }
        });

        targetNumber = await input({
            message: 'Enter the allowed user number (e.g., +1098765432):',
            validate: (val) => {
                const res = phoneSchema.safeParse(val);
                return res.success || res.error.issues[0].message;
            }
        });

        targetGroup = await input({
            message: 'Enter an optional Signal Group name to restrict Tars to (leave blank for 1-on-1):'
        });
    }

    // Agent Prompts Configuration
    let promptsPath = await input({
        message: 'Enter the path to the directory containing Tars agent prompts (like SYSTEM.md):',
        default: 'agent/'
    });

    const resolvedPromptsPath = path.resolve(process.cwd(), promptsPath);
    if (!fs.existsSync(resolvedPromptsPath)) {
        console.log(chalk.yellow(`Creating directory at ${resolvedPromptsPath}...`));
        fs.mkdirSync(resolvedPromptsPath, { recursive: true });
    }

    const systemMdPath = path.join(resolvedPromptsPath, 'SYSTEM.md');
    if (!fs.existsSync(systemMdPath)) {
        console.log(chalk.cyan(`SYSTEM.md not found in ${promptsPath}. Copying default template...`));
        const defaultSystemMdPath = path.join(process.cwd(), 'agent', 'SYSTEM.md');
        if (fs.existsSync(defaultSystemMdPath) && defaultSystemMdPath !== systemMdPath) {
            fs.copyFileSync(defaultSystemMdPath, systemMdPath);
        } else {
            // Fallback content if the project default is somehow also missing
            fs.writeFileSync(systemMdPath, '### STRICT IDENTITY ###\nYou are a lean AI agent.\n\n');
        }
    }

    // Generate .env
    const envPath = path.join(process.cwd(), '.env');
    let envContent = `BOT_SIGNAL_NUMBER=${botNumber}\nTARGET_SIGNAL_NUMBER=${targetNumber}\n`;
    if (targetGroup) {
        envContent += `TARGET_SIGNAL_GROUP=${targetGroup}\n`;
    }
    envContent += `AGENT_PROMPTS_PATH=${promptsPath}\n`;
    envContent += `LLM_PROVIDER=${llmProviderConfig}\n`;
    envContent += `LLM_MAX_ITERATIONS=${maxIterations}\n`;
    if (apiKey) {
        envContent += `GEMINI_API_KEY=${apiKey}\n`;
    }
    envContent += `GEMINI_API_MODEL=${selectedModel}\n`;

    fs.writeFileSync(envPath, envContent);
    console.log(chalk.green(`\n✔ Wrote configuration to ${envPath}`));

    // 5. Setup Launchd
    const setupDaemon = await confirm({ message: 'Do you want to run Tars as a persistent background service (launchd)?' });
    if (setupDaemon) {
        const plistName = 'com.davidgolding.tars.plist';
        const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
        const logsDir = path.join(os.homedir(), 'Library', 'Logs', 'tars');

        fs.mkdirSync(agentsDir, { recursive: true });
        fs.mkdirSync(logsDir, { recursive: true });

        const nodePath = process.execPath;
        const entryPath = path.join(process.cwd(), 'dist', 'index.js');

        if (!fs.existsSync(entryPath)) {
            console.log(chalk.yellow('dist/index.js not found. Running build...'));
            spawnSync('pnpm', ['run', 'build'], { stdio: 'inherit' });
        }

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
    <string>${process.cwd()}</string>

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

        const plistPath = path.join(agentsDir, plistName);
        fs.writeFileSync(plistPath, plistContent);

        console.log(chalk.cyan(`\nLoading daemon ${plistName}...`));
        spawnSync('launchctl', ['unload', plistPath]); // Ignore if it fails
        const loadRes = spawnSync('launchctl', ['load', plistPath]);

        if (loadRes.status === 0) {
            console.log(chalk.green(`✔ Tars is now running in the background!`));
            console.log(chalk.gray(`Logs: ${logsDir}`));
        } else {
            console.log(chalk.red(`Failed to load launchd agent: ${loadRes.stderr?.toString()}`));
        }
    } else {
        console.log(chalk.green('\nSetup complete! You can run Tars manually with `pnpm run start`.'));
    }
}

main().catch(err => {
    console.error(chalk.red('\nSetup failed:'), err);
    process.exit(1);
});
