export interface ToolResponse {
    result?: string;
    error?: string;
}

export function getCurrentTime(): ToolResponse {
    try {
        return {
            result: new Date().toISOString()
        };
    } catch (err: any) {
        return {
            error: err.message || String(err)
        };
    }
}
