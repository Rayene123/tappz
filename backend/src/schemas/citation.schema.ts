import { z } from 'zod';

export const CitationSchema = z.object({
  citations: z.array(
    z.object({
      id: z.number().int().positive(),
      sourceTitle: z.string(),
      excerpt: z.string().max(300),
    })
  ),
});

export type CitationResult = z.infer<typeof CitationSchema>;