import dotenv from 'dotenv';
import removeMd from 'remove-markdown';
import { startSignalListener, sendSignalMessage, sendSignalTyping, stopSignalListener } from './signal.js';
import { runAgentLoop } from './agent.js';
import { initDb, saveMessage, getAgentContext } from './db.js';
import { GeminiCLIProvider } from './llm/gemini-cli-provider.js';
import { GeminiAPIProvider } from './llm/gemini-api-provider.js';

// Load environment variables
dotenv.config();

const BOT_SIGNAL_NUMBER = process.env.BOT_SIGNAL_NUMBER;
const TARGET_SIGNAL_NUMBER = process.env.TARGET_SIGNAL_NUMBER;
const TARGET_SIGNAL_GROUP = process.env.TARGET_SIGNAL_GROUP;

if (!BOT_SIGNAL_NUMBER || !TARGET_SIGNAL_NUMBER) {
    console.error("[Startup Error] Missing BOT_SIGNAL_NUMBER or TARGET_SIGNAL_NUMBER. Please check .env file.");
    process.exit(1);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[System] Received SIGINT. Shutting down gracefully...');
    await stopSignalListener();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[System] Received SIGTERM. Shutting down gracefully...');
    await stopSignalListener();
    process.exit(0);
});

async function main() {
    console.log("Starting Tars Level 4: Modular Architecture...");
    initDb();

    function getAgentName(): string {
        const identity = getAgentContext('IDENTITY');
        if (!identity) return 'Tars';

        // Extract name handling possible multiline or single line values
        const match = identity.match(/- \*\*Name:\*\*(.*?)(?=\n- \*\*|$)/s);
        if (match) {
            const name = match[1].trim();
            if (name && !name.includes('_(pick something')) {
                return name;
            }
        }
        return 'Tars';
    }

    const providerConfig = process.env.LLM_PROVIDER || 'gemini-cli';
    const provider = providerConfig === 'gemini-api'
        ? new GeminiAPIProvider(process.env.GEMINI_API_KEY, process.env.GEMINI_API_MODEL)
        : new GeminiCLIProvider();

    await startSignalListener(
        BOT_SIGNAL_NUMBER!,
        TARGET_SIGNAL_NUMBER!,
        TARGET_SIGNAL_GROUP,
        async (text, sender, groupId) => {
            console.log(`[Tars] Processing message from ${sender}...`);
            saveMessage(sender, text);
            try {
                await sendSignalTyping(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, true, groupId);

                const response = await runAgentLoop(text, provider);

                await sendSignalTyping(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, false, groupId);

                // Strip markdown for Signal compatibility
                let plainResponse = removeMd(response);

                // Prefix Agent Name
                const name = getAgentName();
                const prefix = `${name}: `;
                plainResponse = prefix + plainResponse;

                const textStyles = [`0:${prefix.length}:BOLD`];

                saveMessage(name, plainResponse);
                await sendSignalMessage(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, plainResponse, groupId, textStyles);
            } catch (err: any) {
                console.error("[Tars] Error running agent loop:", err);
                await sendSignalTyping(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, false, groupId);

                let userErrorMessage = "Sorry, an internal error occurred.";
                if (err && err.message) {
                    try {
                        // Attempt to parse if the error message is just a JSON string from Google
                        const jsonStart = err.message.indexOf('{');
                        if (jsonStart !== -1) {
                            const parsed = JSON.parse(err.message.substring(jsonStart));
                            if (parsed.error && parsed.error.message) {
                                userErrorMessage = `I'm having some trouble: ${parsed.error.message}`;
                            } else {
                                userErrorMessage = `I ran into an issue: ${err.message}`;
                            }
                        } else {
                            userErrorMessage = `I couldn't process that: ${err.message}`;
                        }
                    } catch (parseErr) {
                        // Fallback to generic message if parsing fails
                        userErrorMessage = `Sorry, I'm having trouble thinking right now: ${err.message}`;
                    }
                }

                const name = getAgentName();
                const prefix = `${name}: `;
                const textStyles = [`0:${prefix.length}:BOLD`];

                await sendSignalMessage(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, prefix + userErrorMessage, groupId, textStyles);
            }
        }
    );
}

main().catch(err => {
    console.error("[Startup Error] Fatal error starting agent:", err);
    process.exit(1);
});
