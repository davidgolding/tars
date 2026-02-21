import { getSetting, updateSetting } from '../db.js';


export function getSettingTool(key: string) {
    const value = getSetting(key);
    if (value) {
        return value;
    }
    return { error: `Setting not found: ${key}` };
}

export function updateSettingTool(key: string, value: string) {
    if (key === 'bootstrapped') {
        const valIsTimestamp = !isNaN(new Date(value).getTime());
        if (!valIsTimestamp) {
            return { error: 'System policy strictly prohibits setting bootstrapped to anything other than a valid ISO timestamp.' };
        }

        const current = getSetting('bootstrapped');
        if (current && !isNaN(new Date(current).getTime())) {
            return { error: 'System policy strictly prohibits modifying the bootstrapped timestamp once it is set.' };
        }
    }
    updateSetting(key, value);
    return { success: true, message: `Updated setting: ${key}` };
}
