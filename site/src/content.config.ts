import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    author: z.string().default('Peter Bean'),
    readingTime: z.string().optional(),
    /** Set true while the body is an outline/skeleton awaiting GTM final prose. */
    draftProse: z.boolean().default(false),
  }),
});

export const collections = { blog };
