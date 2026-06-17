/**
 * JSON-LD structured-data builders (SEO master-plan §4A).
 *
 * Honesty rules bind these too: NO aggregateRating (we have no real ratings — never
 * fabricate one), price is the real $0, and `sameAs` only lists profiles we can verify.
 * The builders return plain objects; BaseLayout serializes them into
 * <script type="application/ld+json"> tags. Keep values factual.
 */

export const SITE_URL = 'https://wtclaude.com';

/** Absolute URL helper for schema fields. */
export const abs = (path: string): string =>
  path.startsWith('http') ? path : `${SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`;

/**
 * Site-wide Organization. `sameAs` lists only verifiable profiles — GitHub, plus the
 * live WTClaude brand socials confirmed by GTM (X + Telegram, PM-WEB-015).
 */
export const ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'WTClaude',
  url: SITE_URL,
  logo: abs('/assets/wtclaude-app-icon-light.svg'),
  sameAs: [
    'https://github.com/Beannation/wtclaude',
    'https://x.com/getwtclaude',
    'https://t.me/wtclaude_news',
  ],
};

/**
 * SoftwareApplication for the product (Home + /developers).
 * Free → offers price "0". No aggregateRating (honesty — no real ratings yet).
 */
export function softwareApplication(url: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'WTClaude',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'macOS, Linux',
    description:
      'Free, open-source, billing-grade cost tracker for Claude Code. Reads the statusline — the source behind your bill — for real terminal numbers.',
    url,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    publisher: { '@type': 'Organization', name: 'WTClaude', url: SITE_URL },
  };
}

/** Article / BlogPosting for a blog post. */
export function blogPosting(opts: {
  url: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified?: string;
  author: string;
  image: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: opts.headline,
    description: opts.description,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified ?? opts.datePublished,
    author: { '@type': 'Person', name: opts.author },
    image: opts.image,
    mainEntityOfPage: { '@type': 'WebPage', '@id': opts.url },
    publisher: {
      '@type': 'Organization',
      name: 'WTClaude',
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: abs('/assets/wtclaude-app-icon-light.svg') },
    },
  };
}

/**
 * FAQPage from an array of Q/A. Answers are plain text — strip any markdown link
 * syntax so the schema carries the words, not the markup.
 */
export function faqPage(faqs: { q: string; a: string }[]) {
  const stripMd = (s: string) =>
    s
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
      .replace(/`([^`]+)`/g, '$1') // `code` → code
      .trim();
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: stripMd(f.q),
      acceptedAnswer: { '@type': 'Answer', text: stripMd(f.a) },
    })),
  };
}

/** BreadcrumbList from an ordered list of {name, path}. */
export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: abs(it.path),
    })),
  };
}
