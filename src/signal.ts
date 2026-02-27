import { spawn, ChildProcess } from 'node:child_process';

let signalProcess: ChildProcess | null = null;
let eventAbortController: AbortController | null = null;

function getBaseUrl() {
    return `http://127.0.0.1:${process.env.SIGNAL_CLI_PORT || '8080'}`;
}

async function rpcRequest(method: string, params: any = {}): Promise<any> {
    const response = await fetch(`${getBaseUrl()}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: method,
            params: params,
            id: `req-${Date.now()}`
        })
    });

    // signal-cli REST RPC returns 201 for methods that return no data or we get 200 with JSON
    if (response.status === 201) return null;

    const text = await response.text();
    if (!text) return null;

    const data = JSON.parse(text);
    if (data.error) {
        throw new Error(`RPC Error ${data.error.code}: ${data.error.message}`);
    }
    return data.result;
}

async function getGroupId(groupName: string): Promise<string | null> {
    try {
        const groups = await rpcRequest('listGroups');
        if (groups && Array.isArray(groups)) {
            const matching = groups.filter(g => g.name === groupName);
            let activeGroups = matching.filter(g => g.isMember !== false && g.active !== false && !g.isBlocked);
            if (activeGroups.length === 0) activeGroups = matching;
            const group = activeGroups[activeGroups.length - 1]; // Fallback to most recent
            return group ? group.id : null;
        }
    } catch (err) {
        console.error('[Signal] Error fetching group ID:', err);
    }
    return null;
}

/**
 * Sends a typing indicator to a recipient or group
 */
export async function sendSignalTyping(
    botNumber: string,
    recipientNumber: string,
    isTyping: boolean,
    groupId?: string
): Promise<void> {
    try {
        const params: any = { account: botNumber, stop: !isTyping };
        if (groupId) {
            params.groupId = groupId;
        } else {
            params.recipient = [recipientNumber];
        }
        await rpcRequest('sendTyping', params);
    } catch (err) {
        console.error('[Signal] Failed to send typing indicator:', err);
    }
}

export async function stopSignalListener() {
    if (eventAbortController) {
        eventAbortController.abort();
        eventAbortController = null;
    }
    if (signalProcess) {
        console.log('[Signal] Shutting down signal-cli process...');
        signalProcess.kill('SIGTERM');
        signalProcess = null;
    }
}

async function waitForDaemonReady(timeoutMs = 60000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            const res = await fetch(`${getBaseUrl()}/api/v1/check`);
            if (res.ok) return true;
        } catch (e) {
            // connection refused, wait
        }
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

/**
 * Checks if the signal-cli daemon is responsive.
 */
export async function checkSignalStatus(): Promise<boolean> {
    try {
        const res = await fetch(`${getBaseUrl()}/api/v1/check`);
        return res.ok;
    } catch (e) {
        return false;
    }
}

/**
 * Starts the long-running Signal daemon process and attaches an SSE listener.
 */
export async function startSignalListener(
    botNumber: string,
    targetNumber: string,
    targetGroup: string | undefined,
    onMessage: (text: string, sender: string, groupId?: string) => Promise<void>
) {
    if (signalProcess) {
        console.warn('[Signal] Listener already running. Closing existing process...');
        await stopSignalListener();
    }

    console.log(`Starting Signal listener (Daemon) for bot: ${botNumber}`);
    if (targetGroup) {
        console.log(`Restricting listener to group: ${targetGroup}`);
    } else {
        console.log(`Enforcing whitelist for target: ${targetNumber}`);
    }

    const port = process.env.SIGNAL_CLI_PORT || '8080';

    signalProcess = spawn('signal-cli', [
        '-u', botNumber,
        'daemon',
        `--http=127.0.0.1:${port}`,
        '--receive-mode', 'on-start'
    ]) as ChildProcess;

    signalProcess.stderr?.on('data', (data: Buffer) => {
        const stream = data.toString();
        if (process.env.VERBOSE === 'true' || stream.includes('WARN') || stream.includes('ERROR')) {
            console.error(`[signal-cli stderr]: ${stream.trim()}`);
        }
    });

    signalProcess.on('close', (code: number | null) => {
        console.log(`[Signal] signal-cli process exited with code ${code}. Restarting in 5 seconds...`);
        signalProcess = null;
        setTimeout(() => startSignalListener(botNumber, targetNumber, targetGroup, onMessage), 5000);
    });

    console.log('[Signal] Waiting for daemon to be ready...');
    const ready = await waitForDaemonReady();
    if (!ready) {
        console.error('[Signal] Daemon failed to become ready within timeout. Killing process.');
        signalProcess.kill('SIGKILL');
        signalProcess = null;
        return;
    }
    console.log('[Signal] Daemon is ready.');

    // Fetch Target Group ID if needed
    let targetGroupId: string | null = null;
    if (targetGroup) {
        targetGroupId = await getGroupId(targetGroup);
        if (targetGroupId) {
            console.log(`[Signal] Bound to group: ${targetGroup} (${targetGroupId})`);
        } else {
            console.warn(`[Signal] Could not find a group named "${targetGroup}". Check your group settings.`);
        }
    } else {
        console.log(`[Signal] Ready and listening for direct messages from: ${targetNumber}`);
    }

    // Start SSE stream
    eventAbortController = new AbortController();
    try {
        const url = new URL(`${getBaseUrl()}/api/v1/events`);
        url.searchParams.set('account', botNumber);
        const res = await fetch(url, {
            headers: { 'Accept': 'text/event-stream' },
            signal: eventAbortController.signal
        });

        if (!res.ok || !res.body) {
            throw new Error(`SSE failed: HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Process SSE lines
        const processLine = async (line: string) => {
            if (!line.startsWith('data:')) return;
            const dataStr = line.slice(5).trim();
            if (!dataStr) return;

            try {
                const msg = JSON.parse(dataStr);

                if (process.env.VERBOSE === 'true') {
                    console.log(`[DEBUG] Raw Signal receive payloads:\n${JSON.stringify(msg, null, 2)}`);
                }

                if (msg.envelope) {
                    const envelope = msg.envelope;
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
                        console.warn(`[SECURITY] Ignored message from ${sender}. Not in bound target group.`);
                        return;
                    }

                    if (!targetGroupId && sender !== targetNumber) {
                        console.warn(`[SECURITY] Ignored message from non-whitelisted number: ${sender}`);
                        return;
                    }

                    console.log(`[Signal] Received message: "${body}" from ${sender}`);
                    await onMessage(body, sender, msgGroupId);
                }
            } catch (err) {
                console.error('[Signal] Error parsing event data:', err);
            }
        };

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let lineEnd = buffer.indexOf("\n");
            while (lineEnd !== -1) {
                let line = buffer.slice(0, lineEnd);
                buffer = buffer.slice(lineEnd + 1);
                line = line.replace(/\r$/, "");
                if (line) {
                    await processLine(line);
                }
                lineEnd = buffer.indexOf("\n");
            }
        }
    } catch (err: any) {
        if (err.name === 'AbortError') {
            console.log('[Signal] Event stream closed intentionally.');
        } else {
            console.error('[Signal] SSE stream error:', err);
        }
    }
}

/**
 * Sends a message via the active REST API process.
 */
export async function sendSignalMessage(
    botNumber: string,
    recipientNumber: string,
    message: string,
    groupId?: string,
    textStyle?: string[]
): Promise<void> {
    const params: any = { account: botNumber, message: message };
    if (groupId) {
        params.groupId = groupId;
    } else {
        params.recipient = [recipientNumber];
    }
    if (textStyle && textStyle.length > 0) {
        params.textStyle = textStyle;
    }

    console.log(`[Signal] Sending to ${groupId ? 'group ' + groupId : recipientNumber} via REST...`);

    await rpcRequest('send', params);
}
