export type DataErrorCode =
    | 'DATA_INVALID_TYPE'
    | 'DATA_DUPLICATE_OWNER'
    | 'DATA_UNKNOWN_TYPE'
    | 'DATA_UNAUTHORIZED'
    | 'DATA_INVALID_SUBJECT'
    | 'DATA_UNSUPPORTED_SCOPE'
    | 'DATA_UNSUPPORTED_CAPABILITY'
    | 'DATA_BACKEND_UNAVAILABLE'
    | 'DATA_PERSISTENCE_FAILURE'
    | 'DATA_NOT_READY'
    | 'DATA_EXPORT_DENIED'
    | 'DATA_INVALID_STORAGE';

export class DataRegistryError extends Error {
    readonly code: DataErrorCode;

    constructor(code: DataErrorCode, message: string) {
        super(message);
        this.name = 'DataRegistryError';
        this.code = code;
    }
}
