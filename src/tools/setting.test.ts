import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateSettingTool, getSettingTool } from './setting.js';
import * as db from '../db.js';

vi.mock('../db.js', () => ({
    updateSetting: vi.fn(),
    getSetting: vi.fn(),
}));

describe('updateSettingTool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should allow setting bootstrapped to true', () => {
        const result = updateSettingTool('bootstrapped', 'true');
        expect(result).toEqual({ success: true, message: 'Updated setting: bootstrapped' });
        expect(db.updateSetting).toHaveBeenCalledWith('bootstrapped', 'true');
    });

    it('should block setting bootstrapped to false', () => {
        const result = updateSettingTool('bootstrapped', 'false');
        expect(result).toEqual({ error: 'System policy strictly prohibits setting bootstrapped back to false via tools.' });
        expect(db.updateSetting).not.toHaveBeenCalled();
    });

    it('should allow normal settings to be updated', () => {
        const result = updateSettingTool('some_other_setting', 'false');
        expect(result).toEqual({ success: true, message: 'Updated setting: some_other_setting' });
        expect(db.updateSetting).toHaveBeenCalledWith('some_other_setting', 'false');
    });
});
