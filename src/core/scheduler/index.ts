import fs from 'node:fs/promises';
import path from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('TaskScheduler');

export type TaskFunc = () => void | Promise<void>;

export interface JobConfig {
    name: string;
    mode: 'interval' | 'cron';
    intervalSeconds?: number;
    cron?: string;
    nextRun: number;
    enabled: boolean;
}

interface JobState extends JobConfig {
    _isRunning: boolean;
}

export class TaskScheduler {
    private readonly persistencePath: string | null;
    private readonly pollIntervalMs: number;
    
    private jobs = new Map<string, JobState>();
    private registry = new Map<string, TaskFunc>();
    
    private timer: NodeJS.Timeout | null = null;
    private isRunning = false;
    
    private isSaving = false;
    private pendingSave = false;

    constructor(persistencePath?: string, pollIntervalSeconds = 1.0) {
        this.persistencePath = persistencePath ? path.resolve(persistencePath) : null;
        this.pollIntervalMs = pollIntervalSeconds * 1000;
    }

    public async init(): Promise<void> {
        log.info('Initializing Task Scheduler...');
        if (this.persistencePath) {
            await this.load();
        }
    }

    public registerTask(name: string, func: TaskFunc): void {
        if (!name) throw new Error("Task name must be non-empty.");
        if (typeof func !== 'function') throw new TypeError("Task handler must be a callable function.");
        
        this.registry.set(name, func);
        log.debug(`Registered task handler: [${name}]`);
    }

    public async every(name: string, options: { seconds?: number; minutes?: number; hours?: number }, func?: TaskFunc): Promise<JobConfig> {
        const interval = (options.seconds || 0) + (options.minutes || 0) * 60 + (options.hours || 0) * 3600;

        if (interval <= 0) throw new Error("At least one positive interval unit must be provided.");
        if (func) this.registerTask(name, func);
        if (!this.registry.has(name)) throw new Error(`Task '${name}' is not registered.`);

        const job: JobState = {
            name,
            mode: 'interval',
            intervalSeconds: interval,
            nextRun: Date.now() + interval * 1000,
            enabled: true,
            _isRunning: false
        };

        this.jobs.set(name, job);
        await this.save();
        return this.sanitizeJob(job);
    }

    public async cron(name: string, expr: string, func?: TaskFunc): Promise<JobConfig> {
        if (expr.split(' ').length !== 5) throw new Error("Cron expression must have exactly 5 fields.");
        if (func) this.registerTask(name, func);
        if (!this.registry.has(name)) throw new Error(`Task '${name}' is not registered.`);

        const job: JobState = {
            name,
            mode: 'cron',
            cron: expr,
            nextRun: CronExpressionParser.parse(expr).next().getTime(),
            enabled: true,
            _isRunning: false
        };

        this.jobs.set(name, job);
        await this.save();
        return this.sanitizeJob(job);
    }

    public async remove(name: string): Promise<boolean> {
        const had = this.jobs.has(name) || this.registry.has(name);
        this.jobs.delete(name);
        this.registry.delete(name);
        if (had) {
            await this.save();
            log.debug(`Removed scheduled task [${name}]`);
        }
        return had;
    }

    public async removeTask(name: string): Promise<boolean> {
        return this.remove(name);
    }

    public start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        
        this.timer = setInterval(() => this.runPending(), this.pollIntervalMs);
        this.timer.unref(); 
        
        log.info('Task Scheduler started.');
    }

    public stop(): void {
        this.isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        log.info('Task Scheduler stopped.');
    }

    private async runPending(): Promise<void> {
        const now = Date.now();

        for (const job of this.jobs.values()) {
            if (job.enabled && !job._isRunning && job.nextRun <= now) {
                this.executeJob(job).catch(err => log.error(`Fatal scheduler failure on ${job.name}: ${(err as Error).message}`));
            }
        }
    }

    private async executeJob(job: JobState): Promise<void> {
        const func = this.registry.get(job.name);
        if (!func) {
            log.warn(`Task [${job.name}] is scheduled but has no registered handler. Skipping.`);
            return;
        }

        job._isRunning = true;
        
        try {
            await func();
        } catch (error) {
            log.error(`Task [${job.name}] threw an error: ${(error as Error).message}`, { stack: (error as Error).stack });
        } finally {
            this.calculateNextRun(job);
            job._isRunning = false;
            await this.save();
        }
    }

    private calculateNextRun(job: JobState): void {
        const now = Date.now();

        if (job.mode === 'interval' && job.intervalSeconds) {
            job.nextRun += job.intervalSeconds * 1000;
            if (job.nextRun < now) {
                job.nextRun = now + job.intervalSeconds * 1000;
            }
        } else if (job.mode === 'cron' && job.cron) {
            job.nextRun = CronExpressionParser.parse(job.cron).next().getTime();
        }
    }

    private async save(): Promise<void> {
        if (!this.persistencePath) return;

        if (this.isSaving) {
            this.pendingSave = true;
            return;
        }

        this.isSaving = true;

        try {
            await fs.mkdir(path.dirname(this.persistencePath), { recursive: true });
            
            const payload = Array.from(this.jobs.values()).map(job => this.sanitizeJob(job));
            const tempPath = `${this.persistencePath}.tmp`;
            
            await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
            await fs.rename(tempPath, this.persistencePath);
        } catch (err) {
            log.error(`Failed to save schedule state: ${(err as Error).message}`);
        } finally {
            this.isSaving = false;
            if (this.pendingSave) {
                this.pendingSave = false;
                await this.save();
            }
        }
    }

    private async load(): Promise<void> {
        if (!this.persistencePath) return;
        try {
            const data = await fs.readFile(this.persistencePath, 'utf-8');
            const payload: JobConfig[] = JSON.parse(data);
            
            for (const item of payload) {
                this.jobs.set(item.name, { ...item, _isRunning: false });
            }
            log.info(`Loaded ${payload.length} scheduled jobs from disk.`);
        } catch (err: any) {
            if (err.code !== 'ENOENT') log.error(`Failed to load schedule state: ${err.message}`);
        }
    }

    private sanitizeJob(job: JobState): JobConfig {
        const { _isRunning, ...cleanJob } = job;
        return cleanJob;
    }
}

export const scheduler = new TaskScheduler('./.data/schedule.json');