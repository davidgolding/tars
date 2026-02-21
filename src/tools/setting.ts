import { getSetting, updateSetting } from '../db.js';


export function getSettingTool(key: string) {
    const value = getSetting(key);
    if (value) {
        return value;
    }
    return { error: `Setting not found: ${key}` };
}

export function updateSettingTool(key: string, value: string) {
    updateSetting(key, value);
    return { success: true, message: `Updated setting: ${key}` };
}
