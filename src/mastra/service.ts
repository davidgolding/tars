import removeMd from 'remove-markdown';
import { tarsAgent, bootstrapAgent } from './index.js';
import { getSetting, getAgentContext } from '../db.js';
import { notifyUIMessage } from '../signal_events.js';
import { sendSignalTyping, sendSignalMessage } from '../signal.js';
import { channelManager } from '../plugins/channel-manager.js';

const BOT_SIGNAL_NUMBER = process.env.BOT_SIGNAL_NUMBER;
const TARGET_SIGNAL_NUMBER = process.env.TARGET_SIGNAL_NUMBER;
const MAX_ITERATIONS = parseInt(process.env.LLM_MAX_ITERATIONS || '35', 10);

export function getThreadId(sender: string, groupId?: string): string {
  return groupId ? `signal:group:${groupId}` : `signal:dm:${sender}`;
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
  groupId,
  origin = 'signal'
}: {
  text: string;
  sender: string;
  groupId?: string;
  origin?: string; // channelId - 'signal', 'discord', etc.
}) {
  const threadId = getThreadId(sender, groupId);
  console.log(`[Tars] Processing message from ${origin} (${sender})...`);

  let typingInterval: NodeJS.Timeout | null = null;
  
  try {
    // 1. Typing indicators (Signal only for now)
    if (origin === 'signal') {
      typingInterval = setInterval(async () => {
        await sendSignalTyping(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, true, groupId);
      }, 12000);
      await sendSignalTyping(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, true, groupId);
    }

    // 2. Notify UI of User Message (if it didn't come from UI already)
    // Actually, we'll always notify so the mirror stays in sync
    notifyUIMessage({ role: 'user', content: text, threadId });

    // 3. Generate Response
    const bootstrapVal = getSetting('bootstrapped');
    const isBootstrapped = bootstrapVal
      ? !isNaN(new Date(bootstrapVal).getTime()) && new Date(bootstrapVal) <= new Date()
      : false;

    let result;
    if (isBootstrapped) {
      result = await tarsAgent.generate(text, {
        memory: { thread: threadId, resource: TARGET_SIGNAL_NUMBER! },
        maxSteps: MAX_ITERATIONS,
      });
    } else {
      result = await bootstrapAgent.generate(text, {
        maxSteps: MAX_ITERATIONS,
      });
    }

    const response = result.text;
    
    // 4. Notify UI of Assistant Response
    notifyUIMessage({ role: 'assistant', content: response, threadId });

    // 5. Send response to the originating channel
    let plainResponse = removeMd(response);
    const name = getAgentName();
    const prefix = `${name}: `;
    plainResponse = prefix + plainResponse;

    if (origin === 'signal') {
      const textStyles = [`0:${prefix.length}:BOLD`];
      await sendSignalMessage(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, plainResponse, groupId, textStyles);
    } else {
      // Route to other channels via ChannelManager
      const channel = channelManager.getPlugin(origin);
      if (channel) {
        await channel.send(sender, plainResponse);
      } else {
        console.warn(`[Tars] Channel ${origin} not found, cannot send response`);
      }
    }

  } catch (err: any) {
    console.error("[Tars] Error processing message:", err);
    
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

    if (origin === 'signal') {
      const name = getAgentName();
      const prefix = `${name}: `;
      const textStyles = [`0:${prefix.length}:BOLD`];
      await sendSignalMessage(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, prefix + userErrorMessage, groupId, textStyles);
    } else {
      const channel = channelManager.getPlugin(origin);
      if (channel) {
        await channel.send(sender, userErrorMessage);
      }
    }
    
    // Also notify UI of error if needed
    notifyUIMessage({ role: 'assistant', content: `Error: ${userErrorMessage}`, threadId });
    throw err; // Re-throw for API to handle
  } finally {
    if (typingInterval) {
      clearInterval(typingInterval);
    }
    if (origin === 'signal') {
      await sendSignalTyping(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, false, groupId);
    }
  }
}
