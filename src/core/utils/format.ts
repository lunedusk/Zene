import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import duration from 'dayjs/plugin/duration.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import { getLogger, type Logger } from '#core/utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(duration);
dayjs.extend(relativeTime);

const PASCAL_TO_SNAKE_REGEX = /([a-z])([A-Z])/g;

export class Formatter {
    private readonly intlCache = new Map<string, Intl.NumberFormat>();
    
    private _log?: Logger;
    private get log(): Logger {
        if (!this._log) {
            this._log = getLogger('Formatter');
        }
        return this._log;
    }

    private getIntl(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
        const key = `${locale}|${JSON.stringify(options)}`;
        let formatter = this.intlCache.get(key);
        
        if (!formatter) {
            if (this.intlCache.size > 500) {
                this.log.warn('Intl cache exceeded safe limits. Purging to prevent memory leak.');
                this.intlCache.clear();
            }

            try {
                formatter = new Intl.NumberFormat(locale, options);
            } catch (_error) {
                this.log.debug(`Invalid locale requested: ${locale}. Falling back to en-US.`);
                formatter = new Intl.NumberFormat('en-US', options);
            }
            
            this.intlCache.set(key, formatter);
        }
        return formatter;
    }

    public readonly time = {
        toTz: (date: Date | string | number, tz: string, pattern = 'YYYY-MM-DD HH:mm:ss'): string => {
            const d = dayjs(date);
            if (!d.isValid()) {
                this.log.debug(`[time.toTz] Invalid date provided: ${date}`);
                return 'Invalid Date';
            }
            return d.tz(tz).format(pattern);
        },

        discord: (date: Date | number | string, style: 't'|'T'|'d'|'D'|'f'|'F'|'R' = 'f'): string => {
            const d = dayjs(date);
            if (!d.isValid()) return '`Unknown Time`';
            
            const unix = Math.floor(d.valueOf() / 1000);
            return `<t:${unix}:${style}>`;
        },

        ago: (date: Date | number | string): string => {
            const d = dayjs(date);
            return d.isValid() ? d.fromNow() : 'Unknown time ago';
        },

        countdown: (ms: number): string => {
            if (isNaN(ms) || ms <= 0) return '0h 0m 0s';
            const d = dayjs.duration(ms);
            return `${Math.floor(d.asHours())}h ${d.minutes()}m ${d.seconds()}s`;
        }
    } as const;

    public readonly number = {
        compact: (num: number, locale = 'en-US'): string => {
            if (isNaN(num)) return '0';
            const formatter = this.getIntl(locale, { notation: 'compact', maximumFractionDigits: 1 });
            return formatter.format(num);
        },

        currency: (num: number, currency = 'USD', locale = 'en-US'): string => {
            if (isNaN(num)) return '0.00';
            const formatter = this.getIntl(locale, { style: 'currency', currency });
            return formatter.format(num);
        },
        
        percent: (num: number, decimals = 1, locale = 'en-US'): string => {
            if (isNaN(num)) return '0%';
            const formatter = this.getIntl(locale, { 
                style: 'percent', 
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals 
            });
            return formatter.format(num);
        }
    } as const;

    public readonly size = {
        human: (bytes: number): string => {
            if (isNaN(bytes)) return '0 B';
            
            const isNegative = bytes < 0;
            const absBytes = Math.abs(bytes);
            
            if (absBytes === 0) return '0 B';
            
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
            const i = Math.min(Math.floor(Math.log(absBytes) / Math.log(k)), sizes.length - 1);
            
            const value = parseFloat((absBytes / Math.pow(k, i)).toFixed(2));
            return `${isNegative ? '-' : ''}${value} ${sizes[i]}`;
        }
    } as const;

    public readonly string = {
        capitalize: (s: string): string => {
            if (!s) return '';
            return s.charAt(0).toUpperCase() + s.slice(1);
        },
        
        truncate: (s: string, len: number): string => {
            if (!s) return '';
            return s.length > len ? s.substring(0, len - 3) + '...' : s;
        },
        
        pascalToSnake: (s: string): string => {
            if (!s) return '';
            return s.replace(PASCAL_TO_SNAKE_REGEX, '$1_$2').toLowerCase();
        }
    } as const;
}

export const format = new Formatter();