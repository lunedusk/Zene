import { z } from 'zod';

export const langSchema = z
    .object({
        commands: z.object({
            security: z.record(z.string(), z.unknown()),
        }),
    })
    .catchall(z.unknown());

export default langSchema;
