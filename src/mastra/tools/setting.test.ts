import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateSettingTool, getSettingTool } from './setting.js';
import * as db from '../../db.js';

vi.mock('../../db.js', () => ({
    updateSetting: vi.fn(),
    getSetting: vi.fn(),
}));

describe('updateSettingTool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should allow setting bootstrapped to a valid timestamp if not already set', async () => {
        vi.mocked(db.getSetting).mockReturnValue(null);
        const validTime = new Date().toISOString();
        const result = await updateSettingTool.execute!({ key: 'bootstrapped', value: validTime }, {} as any);
        expect(result).toEqual({ success: true, message: 'Updated setting: bootstrapped' });
        expect(db.updateSetting).toHaveBeenCalledWith('bootstrapped', validTime);
    });

    it('should block setting bootstrapped to a boolean or invalid string', async () => {
        vi.mocked(db.getSetting).mockReturnValue(null);
        const result = await updateSettingTool.execute!({ key: 'bootstrapped', value: 'true' }, {} as any);
        expect(result).toEqual({ error: 'System policy strictly prohibits setting bootstrapped to anything other than a valid ISO timestamp.' });
        expect(db.updateSetting).not.toHaveBeenCalled();
    });

    it('should block modifying bootstrapped if it is already a valid timestamp', async () => {
        const existingTime = new Date('2025-01-01T00:00:00Z').toISOString();
        vi.mocked(db.getSetting).mockReturnValue(existingTime);

        const newTime = new Date().toISOString();
        const result = await updateSettingTool.execute!({ key: 'bootstrapped', value: newTime }, {} as any);

        expect(result).toEqual({ error: 'System policy strictly prohibits modifying the bootstrapped timestamp once it is set.' });
        expect(db.updateSetting).not.toHaveBeenCalled();
    });

    it('should allow normal settings to be updated', async () => {
        const result = await updateSettingTool.execute!({ key: 'some_other_setting', value: 'false' }, {} as any);
        expect(result).toEqual({ success: true, message: 'Updated setting: some_other_setting' });
        expect(db.updateSetting).toHaveBeenCalledWith('some_other_setting', 'false');
    });
});
