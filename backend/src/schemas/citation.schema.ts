// src/schemas/citation.schema.ts

import { z } from 'zod';

export const CitationSchema = z.object({
  citations: z.array(
    z.object({
      id: z.number(),
      sourceTitle: z.string(),
      excerpt: z.string(),
    })
  ),
});