/**
 * pnpm ingest — Wikipedia corpus ingestion script
 * Fetches 40 Wikipedia articles about African countries and ingests them.
 */
import 'dotenv/config';
import axios from 'axios';
import { ingestDocuments, Document } from './ingest';
import { logger } from '../utils/logger';

const WIKIPEDIA_USER_AGENT =
  process.env.WIKIPEDIA_USER_AGENT ||
  'tappz-rag-backend/1.0 (local-dev; contact: admin@example.com)';

const wikipediaClient = axios.create({
  headers: {
    'User-Agent': WIKIPEDIA_USER_AGENT,
    'Api-User-Agent': WIKIPEDIA_USER_AGENT,
    Accept: 'application/json',
  },
  timeout: 15000,
});

const COUNTRIES = [
  'Tunisia', 'Morocco', 'Algeria', 'Egypt', 'Libya',
  'Senegal', 'Ghana', 'Nigeria', 'Ethiopia', 'Kenya',
  'Tanzania', 'Uganda', 'Rwanda', 'Cameroon', 'Ivory_Coast',
  'Mali', 'Burkina_Faso', 'Niger', 'Chad', 'Sudan',
  'South_Africa', 'Namibia', 'Botswana', 'Zimbabwe', 'Mozambique',
  'Angola', 'Zambia', 'Madagascar', 'Mauritius', 'Cape_Verde',
  'Togo', 'Benin', 'Liberia', 'Sierra_Leone', 'Guinea',
  'Mauritania', 'Somalia', 'Djibouti', 'Eritrea', 'Comoros',
];

async function fetchWikipedia(title: string): Promise<Document | null> {
  try {
    const normalizedTitle = title.replace(/_/g, ' ');

    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(normalizedTitle)}`;
    const summaryRes = await wikipediaClient.get<{
      title?: string;
      extract?: string;
    }>(summaryUrl);

    if (!summaryRes.data.extract) {
      return null;
    }

    const cleanedIntro = stripHtml(summaryRes.data.extract);
    const sections = cleanedIntro.length > 0
      ? [{ section: 'Introduction', text: cleanedIntro }]
      : [];

    return {
      title: summaryRes.data.title ?? normalizedTitle,
      sourceType: 'wikipedia',
      sections,
    };
  } catch (err) {
    logger.warn(`Failed to fetch ${title}: ${(err as Error).message}`);
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  logger.info('🌍 Starting Wikipedia ingestion for African countries corpus...');
  logger.info(`Fetching ${COUNTRIES.length} articles...`);

  const docs: Document[] = [];

  for (const country of COUNTRIES) {
    process.stdout.write(`  Fetching ${country}... `);
    const doc = await fetchWikipedia(country);
    if (doc && doc.sections.length > 0) {
      docs.push(doc);
      process.stdout.write(`✓ (${doc.sections.length} sections)\n`);
    } else {
      process.stdout.write(`✗ skipped\n`);
    }
    // Rate limit: be nice to Wikipedia API
    await new Promise((r) => setTimeout(r, 200));
  }

  logger.info(`\nIngesting ${docs.length} documents...`);
  await ingestDocuments(docs);

  logger.info('\n🎉 Ingestion complete!');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Ingestion failed:', err);
  process.exit(1);
});