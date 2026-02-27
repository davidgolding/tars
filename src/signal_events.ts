import { EventEmitter } from 'events';

export const uiEvents = new EventEmitter();

export function notifyUIMessage(message: { role: string, content: string, threadId: string }) {
    uiEvents.emit('message', message);
}
