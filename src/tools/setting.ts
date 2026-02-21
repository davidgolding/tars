import { getSetting, updateSetting } from '../db.js';


export function getSettingTool(key: string) {
    const value = getSetting(key);
    if (value) {
        return value;
    }
    return { error: `Setting not found: ${key}` };
}

export function updateSettingTool(key: string, value: string) {
    if (key === 'bootstrapped' && value === 'false') {
        return { error: 'System policy strictly prohibits setting bootstrapped back to false via tools.' };
    }
    updateSetting(key, value);
    return { success: true, message: `Updated setting: ${key}` };
}
