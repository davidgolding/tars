import { spawn, ChildProcessByStdio } from 'node:child_process';
import * as readline from 'node:readline';
import { Writable, Readable } from 'node:stream';

let signalProcess: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
let rl: readline.Interface | null = null;
let messageID = 0;
const rpcCallbacks = new Map<string, (result: any) => void>();

async function getGroupId(groupName: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
        if (!signalProcess || !signalProcess.stdin) return reject('Process not ready');
        const id = `req-${++messageID}`;
        rpcCallbacks.set(id, (res: any) => {
            if (res.result) {
                const groups = res.result.filter((g: any) => g.name === groupName);
                let activeGroups = groups.filter((g: any) => g.isMember !== false && g.active !== false && !g.isBlocked);
                if (activeGroups.length === 0) activeGroups = groups;
                const group = activeGroups[activeGroups.length - 1]; // Fallback to most recent
                resolve(group ? group.id : null);
            } else {
                resolve(null);
            }
        });
        const req = { jsonrpc: '2.0', method: 'listGroups', id };
        signalProcess.stdin.write(JSON.stringify(req) + '\n');
    });
}

/**
 * Sends a typing indicator to a recipient or group
 */
export async function sendSignalTyping(
    _botNumber: string,
    recipientNumber: string,
    isTyping: boolean,
    groupId?: string
): Promise<void> {
    if (!signalProcess || !signalProcess.stdin) {
        return;
    }

    const id = `typ-${++messageID}`;
    const params: any = { stop: !isTyping };
    if (groupId) {
        params.groupId = groupId;
    } else {
        params.recipient = [recipientNumber];
    }

    const request = {
        jsonrpc: '2.0',
        method: 'sendTyping',
        params: params,
        id: id
    };

    try {
        signalProcess.stdin.write(JSON.stringify(request) + '\n');
    } catch (err) {
        console.error('[Signal] Failed to send typing indicator:', err);
    }
}
/**
 * Starts the long-running Signal JSON-RPC process.
 */
export async function startSignalListener(
    botNumber: string,
    targetNumber: string,
    targetGroup: string | undefined,
    onMessage: (text: string, sender: string, groupId?: string) => Promise<void>
) {
    if (signalProcess) {
        console.warn('[Signal] Listener already running. Closing existing process...');
        signalProcess.kill();
    }

    console.log(`Starting Signal listener (JSON-RPC) for bot: ${botNumber}`);
    if (targetGroup) {
        console.log(`Restricting listener to group: ${targetGroup}`);
    } else {
        console.log(`Enforcing whitelist for target: ${targetNumber}`);
    }

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
            console.log(`[Signal] Msg JSON: ${msg}`);

            // Handle incoming messages
            if (msg.method === 'receive') {
                const envelope = msg.params?.envelope;
                if (!envelope) return;

                const sender = envelope.source;
                const dataMsg = envelope.dataMessage;
                const syncMsg = envelope.syncMessage;

                const groupInfo = dataMsg?.groupInfo || syncMsg?.sentMessage?.groupInfo;
                const msgGroupId = groupInfo?.groupId;

                const body = dataMsg?.message || syncMsg?.sentMessage?.message;

                if (!sender || !body) return;

                const normalizeBase64 = (b64: string | null | undefined) => b64 ? b64.replace(/=+$/, '') : undefined;

                const normTargetId = normalizeBase64(targetGroupId);
                const normMsgId = normalizeBase64(msgGroupId);

                if (targetGroupId && normMsgId !== normTargetId) {
                    console.warn(`[SECURITY] Ignored message from ${sender}. Not in bound target group. Detected msgGroupId: ${msgGroupId} | Expected: ${targetGroupId}`);
                    return; // Ignore messages not in the target group
                }

                if (!targetGroupId && sender !== targetNumber) {
                    console.warn(`[SECURITY] Ignored message from non-whitelisted number: ${sender}`);
                    return;
                }

                console.log(`[Signal] Received message: "${body}" from ${sender}`);
                await onMessage(body, sender, msgGroupId);
            }
            // Handle JSON-RPC responses
            else if (msg.result || msg.error) {
                if (msg.id && rpcCallbacks.has(msg.id)) {
                    rpcCallbacks.get(msg.id)!(msg);
                    rpcCallbacks.delete(msg.id);
                }
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
        setTimeout(() => startSignalListener(botNumber, targetNumber, targetGroup, onMessage), 5000);
    });

    // After setting up process, dispatch getGroupId if needed
    let targetGroupId: string | null = null;
    if (targetGroup) {
        setTimeout(async () => {
            targetGroupId = await getGroupId(targetGroup);
            if (targetGroupId) {
                console.log(`[Signal] Bound to group: ${targetGroup} (${targetGroupId})`);
            } else {
                console.warn(`[Signal] Could not find a group named "${targetGroup}". Check your group settings.`);
            }
        }, 1000); // give signal-cli a moment to start
    }
}

/**
 * Sends a message via the active JSON-RPC process.
 */
export async function sendSignalMessage(
    _botNumber: string, // Kept for compatibility, but uses the global process
    recipientNumber: string,
    message: string,
    groupId?: string,
    textStyle?: string[]
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!signalProcess || !signalProcess.stdin) {
            return reject(new Error('Signal process not started or stdin not available'));
        }

        const id = `msg-${++messageID}`;
        const params: any = { message: message };
        if (groupId) {
            params.groupId = groupId;
        } else {
            params.recipient = [recipientNumber];
        }
        if (textStyle && textStyle.length > 0) {
            params.textStyle = textStyle;
        }

        const request = {
            jsonrpc: '2.0',
            method: 'send',
            params: params,
            id: id
        };

        console.log(`[Signal] Sending to ${groupId ? 'group ' + groupId : recipientNumber} via JSON-RPC...`);

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
