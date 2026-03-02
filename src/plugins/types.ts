export interface PluginConfig {
  [key: string]: string | number | boolean | undefined;
}

export interface PluginStatus {
  online: boolean;
  lastError?: string;
}

export interface MessagePayload {
  text: string;
  sender: string;
  channelId: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export type MessageHandler = (payload: MessagePayload) => Promise<void>;

export interface Plugin {
  id: string;
  name: string;
  type: 'channel' | 'adapter';
  version: string;
  init(config: PluginConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): PluginStatus;
}

export interface PluginSetupRoute {
  method: 'get' | 'post';
  path: string;
  handler: (req: any, res: any) => void;
}

export interface ChannelPlugin extends Plugin {
  type: 'channel';
  send(recipient: string, message: string): Promise<void>;
  sendTyping?(recipient: string, isTyping: boolean, metadata?: Record<string, unknown>): Promise<void>;
  onMessage(handler: MessageHandler): void;
  getChannelId(): string;
  getSetupRoutes?(): PluginSetupRoute[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  repository?: string;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  type: 'channel' | 'adapter';
  version: string;
  enabled: boolean;
  installedAt: string;
}
