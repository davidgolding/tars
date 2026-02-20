import { spawn, ChildProcessByStdio } from 'node:child_process';
import * as readline from 'node:readline';
import { Writable, Readable } from 'node:stream';

let signalProcess: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
let rl: readline.Interface | null = null;
let messageID = 0;

/**
 * Starts the long-running Signal JSON-RPC process.
 */
export async function startSignalListener(
    botNumber: string,
    targetNumber: string,
    onMessage: (text: string, sender: string) => Promise<void>
) {
    if (signalProcess) {
        console.warn('[Signal] Listener already running. Closing existing process...');
        signalProcess.kill();
    }

    console.log(`Starting Signal listener (JSON-RPC) for bot: ${botNumber}`);
    console.log(`Enforcing whitelist for target: ${targetNumber}`);

    signalProcess = spawn('signal-cli', [
        '-u', botNumber,
        'jsonRpc',
        '--receive-mode', 'on-start'
    ], {
        stdio: ['pipe', 'pipe', 'pipe']
    }) as ChildProcessByStdio<Writable, Readable, Readable>;

    rl = readline.createInterface({
        input: signalProcess.stdout,
        terminal: false
    });

    rl.on('line', async (line) => {
        try {
            if (!line.trim()) return;
            const msg = JSON.parse(line);

            // Handle incoming messages
            if (msg.method === 'receive') {
                const envelope = msg.params?.envelope;
                if (!envelope) return;

                const sender = envelope.source;
                const dataMsg = envelope.dataMessage;
                const syncMsg = envelope.syncMessage;

                const body = dataMsg?.message || syncMsg?.sentMessage?.message;

                if (!sender || !body) return;

                if (sender !== targetNumber) {
                    console.warn(`[SECURITY] Ignored message from non-whitelisted number: ${sender}`);
                    return;
                }

                console.log(`[Signal] Received message: "${body}" from ${sender}`);
                await onMessage(body, sender);
            }
            // Handle JSON-RPC responses (optional logging)
            else if (msg.result || msg.error) {
                // console.log(`[Signal RPC Response] ID ${msg.id}:`, msg.result || msg.error);
            }

        } catch (err) {
            console.error('[Signal] Error parsing message line:', err);
        }
    });

    signalProcess.stderr.on('data', (data: Buffer) => {
        const stream = data.toString();
        // Only log actual warnings/errors, suppress info/debug unless explicitly needed
        if (stream.includes('WARN') || stream.includes('ERROR')) {
            console.error(`[signal-cli stderr]: ${stream.trim()}`);
        }
    });

    signalProcess.on('close', (code: number | null) => {
        console.log(`[Signal] signal-cli process exited with code ${code}. Restarting in 5 seconds...`);
        signalProcess = null;
        setTimeout(() => startSignalListener(botNumber, targetNumber, onMessage), 5000);
    });
}

/**
 * Sends a message via the active JSON-RPC process.
 */
export async function sendSignalMessage(
    _botNumber: string, // Kept for compatibility, but uses the global process
    recipientNumber: string,
    message: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!signalProcess || !signalProcess.stdin) {
            return reject(new Error('Signal process not started or stdin not available'));
        }

        const id = `msg-${++messageID}`;
        const request = {
            jsonrpc: '2.0',
            method: 'send',
            params: {
                recipient: [recipientNumber],
                message: message
            },
            id: id
        };

        console.log(`[Signal] Sending to ${recipientNumber} via JSON-RPC...`);

        try {
            signalProcess.stdin.write(JSON.stringify(request) + '\n', (err) => {
                if (err) {
                    reject(err);
                } else {
                    // We resolve immediately because we won't wait for the RPC response line 
                    // for simplicity, but we could wait if we wanted full confirmation.
                    resolve();
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}
