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

    it('should allow setting bootstrapped to a valid timestamp if not already set', () => {
        vi.mocked(db.getSetting).mockReturnValue(null); // Not set
        const validTime = new Date().toISOString();
        const result = updateSettingTool('bootstrapped', validTime);
        expect(result).toEqual({ success: true, message: 'Updated setting: bootstrapped' });
        expect(db.updateSetting).toHaveBeenCalledWith('bootstrapped', validTime);
    });

    it('should block setting bootstrapped to a boolean or invalid string', () => {
        vi.mocked(db.getSetting).mockReturnValue(null);
        const result = updateSettingTool('bootstrapped', 'true');
        expect(result).toEqual({ error: 'System policy strictly prohibits setting bootstrapped to anything other than a valid ISO timestamp.' });
        expect(db.updateSetting).not.toHaveBeenCalled();
    });

    it('should block modifying bootstrapped if it is already a valid timestamp', () => {
        const existingTime = new Date('2025-01-01T00:00:00Z').toISOString();
        vi.mocked(db.getSetting).mockReturnValue(existingTime); // Already set

        const newTime = new Date().toISOString();
        const result = updateSettingTool('bootstrapped', newTime);

        expect(result).toEqual({ error: 'System policy strictly prohibits modifying the bootstrapped timestamp once it is set.' });
        expect(db.updateSetting).not.toHaveBeenCalled();
    });

    it('should allow normal settings to be updated', () => {
        const result = updateSettingTool('some_other_setting', 'false');
        expect(result).toEqual({ success: true, message: 'Updated setting: some_other_setting' });
        expect(db.updateSetting).toHaveBeenCalledWith('some_other_setting', 'false');
    });
});
