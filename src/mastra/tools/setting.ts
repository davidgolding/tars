import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSetting, updateSetting } from '../../db.js';

export const getSettingTool = createTool({
    id: 'get_setting',
    description: 'Returns the value of a specific setting key.',
    inputSchema: z.object({
        key: z.string().describe('The setting key to retrieve'),
    }),
    execute: async (inputData) => {
        const value = getSetting(inputData.key);
        if (value !== null) {
            return { value };
        }
        return { error: `Setting not found: ${inputData.key}` };
    },
});

export const updateSettingTool = createTool({
    id: 'update_setting',
    description: 'Updates or creates a setting value. The bootstrapped key can only be set to a valid ISO timestamp and cannot be changed once set.',
    inputSchema: z.object({
        key: z.string().describe('The setting key'),
        value: z.string().describe('The value to store'),
    }),
    execute: async (inputData) => {
        if (inputData.key === 'bootstrapped') {
            const valIsTimestamp = !isNaN(new Date(inputData.value).getTime());
            if (!valIsTimestamp) {
                return { error: 'System policy strictly prohibits setting bootstrapped to anything other than a valid ISO timestamp.' };
            }

            const current = getSetting('bootstrapped');
            if (current && !isNaN(new Date(current).getTime())) {
                return { error: 'System policy strictly prohibits modifying the bootstrapped timestamp once it is set.' };
            }
        }
        updateSetting(inputData.key, inputData.value);
        return { success: true, message: `Updated setting: ${inputData.key}` };
    },
});
