import { z } from 'zod';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

export const jsonSchema = (schema: z.ZodType): SchemaObject =>
  z.toJSONSchema(schema, { io: 'input' }) as SchemaObject;
