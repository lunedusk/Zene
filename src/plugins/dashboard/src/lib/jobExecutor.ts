




import {
    getJob,
    updateJob,
    executeJobOnce,
    processDueJobs,
    type JobRecord,
    type JobStatus,
} from '../../../dash-data/src/repositories/jobRepository.js';

export interface JobLease {
    readonly jobId: string;
    readonly ownerId: string;
    readonly leasedAt: number;
    readonly leaseExpiresAt: number;
}

const leases = new Map<string, JobLease>();
const DEFAULT_LEASE_MS = 30_000;

export interface JobExecutorOptions {
    workerId: string;
    leaseMs?: number;
    concurrency?: number;
}

export class JobExecutor {
    private readonly workerId: string;
    private readonly leaseMs: number;
    private readonly concurrency: number;
    private running = 0;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(opts: JobExecutorOptions) {
        this.workerId = opts.workerId;
        this.leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
        this.concurrency = opts.concurrency ?? 4;
    }

    start(pollMs = 2_000): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            void this.tick();
        }, pollMs);

        if (typeof this.timer === 'object' && this.timer && 'unref' in this.timer) {
            (this.timer as NodeJS.Timeout).unref();
        }
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async tick(): Promise<{ processed: number }> {

        const now = Date.now();
        for (const [jobId, lease] of leases) {
            if (lease.leaseExpiresAt <= now) {
                leases.delete(jobId);
                const job = await getJob(jobId);
                if (job && job.status === 'running') {
                    await updateJob(jobId, {
                        status: 'retrying' as JobStatus,
                        error: 'lease_expired',
                        nextAttemptAt: now + 1_000,
                    });
                }
            }
        }


        await processDueJobs(now);

        let processed = 0;
        while (this.running < this.concurrency) {


            break;
        }
        void processed;
        return { processed };
    }




    async executeWithLease(jobId: string): Promise<JobRecord | null> {
        const now = Date.now();
        const existing = leases.get(jobId);
        if (existing && existing.ownerId !== this.workerId && existing.leaseExpiresAt > now) {
            return getJob(jobId);
        }
        leases.set(jobId, {
            jobId,
            ownerId: this.workerId,
            leasedAt: now,
            leaseExpiresAt: now + this.leaseMs,
        });
        this.running += 1;
        try {
            const result = await executeJobOnce(jobId);
            return result;
        } finally {
            this.running = Math.max(0, this.running - 1);
            leases.delete(jobId);
        }
    }

    heartbeat(jobId: string): boolean {
        const lease = leases.get(jobId);
        if (!lease || lease.ownerId !== this.workerId) return false;
        leases.set(jobId, {
            ...lease,
            leaseExpiresAt: Date.now() + this.leaseMs,
        });
        return true;
    }
}

let singleton: JobExecutor | null = null;

export function getJobExecutor(workerId = 'local'): JobExecutor {
    if (!singleton) {
        singleton = new JobExecutor({ workerId });
    }
    return singleton;
}
