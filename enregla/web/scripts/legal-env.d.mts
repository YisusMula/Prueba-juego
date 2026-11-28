export declare const REQUIRED_LEGAL_ENV: { key: string; label: string }[];
export declare const OPTIONAL_LEGAL_ENV: string[];
export declare function missingLegalEnv(env: Record<string, string | undefined>): { key: string; label: string }[];
export declare function checkLegalEnv(env: Record<string, string | undefined>): string | null;
