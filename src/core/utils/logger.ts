import winston from 'winston';
import TransportStream from 'winston-transport';
import 'winston-daily-rotate-file';
import util from 'util';
import { format } from './format.js';
import { secrets } from '#core/helpers/secretManager.js';
import { redactSensitiveData } from './redaction.js';

export type Logger = winston.Logger & {
    fatal: winston.LeveledLogMethod;
};

export interface LogErrorPayload {
    message: string;
    stack?: string;
    name: string
    timestamp: string;
}

type ErrorEmitFn = (payload: LogErrorPayload) => void;

let _errorEmitter: ErrorEmitFn | null = null;

export function injectLogErrorEmitter(fn: ErrorEmitFn): void {
    if (_errorEmitter) return;
    _errorEmitter = fn;
}

const isProd = process.env.NODE_ENV === 'production';

const getLogTz = () => {
    try {
        return secrets?.getOptional?.('LogTZ') || process.env.TZ || 'UTC';
    } catch {
        return 'UTC';
    }
};

const getDefaultLevel = () => {
    try {
        return secrets?.getOptional?.('LogLevel') || process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');
    } catch {
        return isProd ? 'info' : 'debug';
    }
};

const SESSION_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const CUSTOM_LEVELS = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
};

const LEVEL_COLORS: Record<string, string> = {
    debug:  '\x1b[38;2;0;255;215m',
    info:   '\x1b[38;2;135;206;250m',
    warn:   '\x1b[38;2;255;255;0m',
    error:  '\x1b[38;2;255;80;80m',
    fatal:  '\x1b[48;2;180;0;0m\x1b[38;2;255;255;255m',
};

const redactFormat = winston.format((info) => {
    Object.assign(info, redactSensitiveData(info));
    return info;
});

const humanReadableFormat = winston.format.printf((info) => {
    const { level, message, timestamp, name, stack, metadata } = info;
    // eslint-disable-next-line no-control-regex -- intentional ANSI SGR strip for log level parsing
    const rawLevel = level.replace(/\u001b\[[0-9;]*m/g, '').toLowerCase();
    const colorize = info.colorize === true;
    const color  = colorize ? (LEVEL_COLORS[rawLevel] || '') : '';
    const reset  = colorize ? '\x1b[0m' : '';
    const modName = name || 'app';

    let msg = `[${timestamp}] [${color}${modName}${reset}] [${color}${level.toUpperCase()}${reset}] ${message}`;

    if (stack) msg += `\n${color}${stack}${reset}`;

    if (metadata && Object.keys(metadata).length > 0) {
        const inspected = util.inspect(redactSensitiveData(metadata), { depth: 3, colors: colorize, compact: false, breakLength: 80 });
        msg += `\n  ↳ ${inspected}`;
    }

    return msg;
});

const sharedTransports = [
    new winston.transports.Console({
        format: winston.format.combine(
            redactFormat(),
            winston.format((info) => { info.colorize = true; return info; })(),
            humanReadableFormat
        ),
    }),

    new winston.transports.DailyRotateFile({
        dirname: `logs/console/session-${SESSION_ID}`,
        filename: '%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '50m',
        maxFiles: '14d',
        auditFile: 'logs/.audit/combined-audit.json',
        format: winston.format.combine(
            redactFormat(),
            winston.format.errors({ stack: true }),
            winston.format.uncolorize(),
            humanReadableFormat
        ),
    }),

    new winston.transports.DailyRotateFile({
        level: 'error',
        dirname: `logs/console/error/session-${SESSION_ID}`,
        filename: '%DATE%-error.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        auditFile: 'logs/.audit/error-audit.json',
        format: winston.format.combine(
            redactFormat(),
            winston.format.errors({ stack: true }),
            winston.format.uncolorize(),
            humanReadableFormat
        ),
    }),
];

class ErrorInterceptTransport extends TransportStream {
    constructor() {
        super({ level: 'error' });
    }

    override log(info: any, callback: () => void): void {
        setImmediate(() => {
            if (_errorEmitter) {
                // eslint-disable-next-line no-control-regex -- intentional ANSI SGR strip for log level parsing
                const rawLevel = (info.level as string).replace(/\u001b\[[0-9;]*m/g, '').toLowerCase();
                if (rawLevel === 'error' || rawLevel === 'fatal') {
                    const redactedInfo = redactSensitiveData(info) as Record<string, unknown>;
                    _errorEmitter({
                        message:   String(redactedInfo.message ?? info.message ?? ''),
                        stack:     redactedInfo.stack as string | undefined,
                        name:      String(redactedInfo.name ?? info.name ?? 'unknown'),
                        timestamp: String(redactedInfo.timestamp ?? info.timestamp ?? ''),
                    });
                }
            }
            this.emit('logged', info);
        });
        callback();
    }
}

const globalLogger = winston.createLogger({
    levels: CUSTOM_LEVELS,
    level: getDefaultLevel(),
    exitOnError: false,
    format: winston.format.combine(
        winston.format.timestamp({
            format: () => format.time.toTz(new Date(), getLogTz(), 'YYYY-MM-DD HH:mm:ss.SSS Z'),
        }),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'name', 'stack'] }),
        redactFormat()
    ),
    transports: [...sharedTransports, new ErrorInterceptTransport()],
});

let logsClosed = false;

export async function flushLogs(): Promise<void> {
    if (logsClosed) return;
    logsClosed = true;
    return new Promise((resolve) => {
        const transports = [...globalLogger.transports];
        if (transports.length === 0) {
            try {
                globalLogger.end();
            } catch {

            }
            resolve();
            return;
        }

        let finished = 0;
        const done = () => {
            finished++;
            if (finished >= transports.length) {
                clearTimeout(timer);
                try {
                    globalLogger.end();
                } catch {

                }
                resolve();
            }
        };
        const timer = setTimeout(() => {
            try {
                globalLogger.end();
            } catch {

            }
            resolve();
        }, 1000);

        for (const t of transports) {
            t.once('finish', done);
            try {
                if (typeof (t as { end?: () => void }).end === 'function') {
                    (t as { end: () => void }).end();
                } else {
                    done();
                }
            } catch {
                done();
            }
        }
    });
}

export function isLogsClosed(): boolean {
    return logsClosed;
}

export function getLogger(name: string = 'app', level: string = getDefaultLevel()): Logger {
    const child = globalLogger.child({ name });
    child.level = level;
    return child as Logger;
}