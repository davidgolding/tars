import { spawn, ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';

/**
 * A lightweight MCP client for connecting to local servers via STDIO.
 */
export class MCPClient {
    private process: ChildProcess | null = null;
    private rl: readline.Interface | null = null;
    private messageID = 0;
    private pendingRequests = new Map<number, (res: any) => void>();

    constructor(private command: string, private args: string[] = []) { }

    async connect() {
        console.log(`[MCP] Connecting to server: ${this.command} ${this.args.join(' ')}`);

        this.process = spawn(this.command, this.args, {
            stdio: ['pipe', 'pipe', 'inherit']
        });

        this.rl = readline.createInterface({
            input: this.process.stdout!,
            terminal: false
        });

        this.rl.on('line', (line) => {
            try {
                const msg = JSON.parse(line);
                if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                    const resolve = this.pendingRequests.get(msg.id)!;
                    this.pendingRequests.delete(msg.id);
                    resolve(msg);
                }
            } catch (err) {
                // Ignore parse errors from non-JSON lines
            }
        });

        // Initialize the server
        await this.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'Tars-Client', version: '1.0.0' }
        });

        await this.notify('notifications/initialized', {});
        console.log('[MCP] Server initialized.');
    }

    async listTools() {
        const response = await this.request('tools/list', {});
        return response.result?.tools || [];
    }

    async callTool(name: string, args: any) {
        const response = await this.request('tools/call', {
            name,
            arguments: args
        });
        return response.result;
    }

    private request(method: string, params: any): Promise<any> {
        return new Promise((resolve) => {
            const id = ++this.messageID;
            this.pendingRequests.set(id, resolve);
            const msg = { jsonrpc: '2.0', id, method, params };
            this.process?.stdin?.write(JSON.stringify(msg) + '\n');
        });
    }

    private async notify(method: string, params: any) {
        const msg = { jsonrpc: '2.0', method, params };
        this.process?.stdin?.write(JSON.stringify(msg) + '\n');
    }

    disconnect() {
        this.process?.kill();
        this.process = null;
    }
}
