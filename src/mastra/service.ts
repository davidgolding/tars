import removeMd from 'remove-markdown';
import { tarsAgent, bootstrapAgent } from './index.js';
import { getSetting, getAgentContext } from '../db.js';
import { notifyUIMessage } from '../events.js';
import { channelManager } from '../plugins/channel-manager.js';

const MAX_ITERATIONS = parseInt(process.env.LLM_MAX_ITERATIONS || '35', 10);

export function getThreadId(channelId: string, sender: string, metadata?: Record<string, unknown>): string {
  const groupId = metadata?.groupId as string | undefined;
  return groupId ? `${channelId}:group:${groupId}` : `${channelId}:dm:${sender}`;
}

export function getAgentName(): string {
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

export async function processAgentMessage({
  text,
  sender,
  channelId,
  metadata,
}: {
  text: string;
  sender: string;
  channelId: string;
  metadata?: Record<string, unknown>;
}) {
  const threadId = getThreadId(channelId, sender, metadata);
  console.log(`[Tars] Processing message from ${channelId} (${sender})...`);

  const plugin = channelManager.getPlugin(channelId);
  let typingInterval: NodeJS.Timeout | null = null;

  try {
    // 1. Typing indicators
    if (plugin?.sendTyping) {
      typingInterval = setInterval(async () => {
        await plugin.sendTyping!(sender, true, metadata);
      }, 12000);
      await plugin.sendTyping(sender, true, metadata);
    }

    // 2. Notify UI
    notifyUIMessage({ role: 'user', content: text, threadId });

    // 3. Generate Response
    const bootstrapVal = getSetting('bootstrapped');
    const isBootstrapped = bootstrapVal
      ? !isNaN(new Date(bootstrapVal).getTime()) && new Date(bootstrapVal) <= new Date()
      : false;

    let result;
    if (isBootstrapped) {
      result = await tarsAgent.generate(text, {
        memory: { thread: threadId, resource: sender },
        maxSteps: MAX_ITERATIONS,
      });
    } else {
      result = await bootstrapAgent.generate(text, {
        maxSteps: MAX_ITERATIONS,
      });
    }

    const response = result.text;

    // 4. Notify UI
    notifyUIMessage({ role: 'assistant', content: response, threadId });

    // 5. Send response to the originating channel
    let plainResponse = removeMd(response);
    const name = getAgentName();
    const prefix = `${name}: `;
    plainResponse = prefix + plainResponse;

    if (plugin) {
      await plugin.send(sender, plainResponse);
    } else {
      console.warn(`[Tars] Channel ${channelId} not found, cannot send response`);
    }
  } catch (err: any) {
    console.error('[Tars] Error processing message:', err);

    let userErrorMessage = 'Sorry, an internal error occurred.';
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

    if (plugin) {
      await plugin.send(sender, userErrorMessage);
    }

    notifyUIMessage({ role: 'assistant', content: `Error: ${userErrorMessage}`, threadId });
    throw err;
  } finally {
    if (typingInterval) {
      clearInterval(typingInterval);
    }
    if (plugin?.sendTyping) {
      await plugin.sendTyping(sender, false, metadata);
    }
  }
}
