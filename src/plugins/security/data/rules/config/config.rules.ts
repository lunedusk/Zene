export interface SecurityConfigShape {
    enabled?: boolean;
    dataBackend?: {
        engine?: string;
        alias?: string;
    };
}

export default function configRules(data: SecurityConfigShape): string[] {
    const issues: string[] = [];
    const eng = data.dataBackend?.engine?.toLowerCase();
    if (eng && !['sqlite', 'postgres', 'mongo', 'native-sqlite', 'native-pg', 'postgresql', 'pg', 'mongodb'].includes(eng)) {
        issues.push(`dataBackend.engine unsupported: ${eng}`);
    }
    if (data.dataBackend?.alias != null && !String(data.dataBackend.alias).trim()) {
        issues.push('dataBackend.alias must be non-empty when set');
    }
    return issues;
}
