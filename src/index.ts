import dotenv from 'dotenv';
import removeMd from 'remove-markdown';
import { startSignalListener, sendSignalMessage, sendSignalTyping, stopSignalListener } from './signal.js';
import { initDb, getAgentContext } from './db.js';

// Load environment variables
dotenv.config();

const BOT_SIGNAL_NUMBER = process.env.BOT_SIGNAL_NUMBER;
const TARGET_SIGNAL_NUMBER = process.env.TARGET_SIGNAL_NUMBER;
const TARGET_SIGNAL_GROUP = process.env.TARGET_SIGNAL_GROUP;

if (!BOT_SIGNAL_NUMBER || !TARGET_SIGNAL_NUMBER) {
    console.error("[Startup Error] Missing BOT_SIGNAL_NUMBER or TARGET_SIGNAL_NUMBER. Please check .env file.");
    process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
    console.error('[Startup] GEMINI_API_KEY is required.');
    process.exit(1);
}

const MAX_ITERATIONS = parseInt(process.env.LLM_MAX_ITERATIONS || '35', 10);

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
    console.log("Starting Tars...");
    initDb();

    // Import tarsAgent after DB is initialized (buildSystemPrompt reads from DB)
    const { tarsAgent } = await import('./mastra/index.js');

    function getAgentName(): string {
        const identity = getAgentContext('IDENTITY');
        if (!identity) return 'Tars';

        const match = identity.match(/- \*\*Name:\*\*(.*?)(?=\n- \*\*|$)/s);
        if (match) {
            const name = match[1].trim();
            if (name && !name.includes('_(pick something')) {
                return name;
            }
        }
        return 'Tars';
    }

    await startSignalListener(
        BOT_SIGNAL_NUMBER!,
        TARGET_SIGNAL_NUMBER!,
        TARGET_SIGNAL_GROUP,
        async (text, sender, groupId) => {
            console.log(`[Tars] Processing message from ${sender}...`);
            try {
                await sendSignalTyping(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, true, groupId);

                const threadId = groupId ? `signal:group:${groupId}` : `signal:dm:${sender}`;
                const result = await tarsAgent.generate(text, {
                    memory: { thread: threadId, resource: TARGET_SIGNAL_NUMBER! },
                    maxSteps: MAX_ITERATIONS,
                });
                const response = result.text;

                await sendSignalTyping(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, false, groupId);

                // Strip markdown for Signal compatibility
                let plainResponse = removeMd(response);

                // Prefix Agent Name
                const name = getAgentName();
                const prefix = `${name}: `;
                plainResponse = prefix + plainResponse;

                const textStyles = [`0:${prefix.length}:BOLD`];

                await sendSignalMessage(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, plainResponse, groupId, textStyles);
            } catch (err: any) {
                console.error("[Tars] Error running agent:", err);
                await sendSignalTyping(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, false, groupId);

                let userErrorMessage = "Sorry, an internal error occurred.";
                if (err && err.message) {
                    try {
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
