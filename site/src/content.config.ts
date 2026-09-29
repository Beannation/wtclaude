import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    /** Date of the latest dated update box — becomes BlogPosting.dateModified (QA-0928-197). */
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('Peter Bean'),
    readingTime: z.string().optional(),
    /** Set true while the body is an outline/skeleton awaiting GTM final prose. */
    draftProse: z.boolean().default(false),
    /**
     * Optional FAQ pairs (verbatim from the post body) → FAQPage JSON-LD for rich results.
     * Mirror the post's own FAQ section; do not author new Q&As here.
     */
    faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  }),
});

export const collections = { blog };
