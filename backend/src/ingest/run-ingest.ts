/**
 * pnpm ingest — Wikipedia corpus ingestion script
 */
import 'dotenv/config';
import axios from 'axios';
import { ingestDocuments, Document } from './ingest.js';
import { logger } from '../utils/logger.js';

const WIKIPEDIA_USER_AGENT =
  process.env.WIKIPEDIA_USER_AGENT ||
  'tappz-rag-backend/1.0';

const wikipediaClient = axios.create({
  headers: {
    'User-Agent': WIKIPEDIA_USER_AGENT,
    Accept: 'application/json',
  },
  timeout: 15000,
});

const COUNTRIES = [
  'Tunisia','Morocco','Algeria','Egypt','Libya',
  'Senegal','Ghana','Nigeria','Ethiopia','Kenya',
  'Tanzania','Uganda','Rwanda','Cameroon','Ivory_Coast',
  'Mali','Burkina_Faso','Niger','Chad','Sudan',
  'South_Africa','Namibia','Botswana','Zimbabwe','Mozambique',
  'Angola','Zambia','Madagascar','Mauritius','Cape_Verde',
  'Togo','Benin','Liberia','Sierra_Leone','Guinea',
  'Mauritania','Somalia','Djibouti','Eritrea','Comoros',
];

// ---------------------------
// SECTION CLASSIFIER
// ---------------------------
function classifySection(text: string): string {
  const t = text.toLowerCase();

  if (t.includes('gdp') || t.includes('economy') || t.includes('industry'))
    return 'Economy';

  if (
    t.includes('capital') ||
    t.includes('city') ||
    t.includes('geography') ||
    t.includes('located') ||
    t.includes('border')
  )
    return 'Geography';

  if (t.includes('war') || t.includes('independence') || t.includes('history'))
    return 'History';

  if (
    t.includes('president') ||
    t.includes('government') ||
    t.includes('election')
  )
    return 'Politics';

  if (
    t.includes('population') ||
    t.includes('ethnic') ||
    t.includes('language') ||
    t.includes('religion')
  )
    return 'Demographics';

  return 'General';
}

// ---------------------------
// FETCH WIKIPEDIA
// ---------------------------
async function fetchWikipedia(title: string): Promise<Document | null> {
  try {
    const normalized = title.replace(/_/g, ' ');

    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      normalized,
    )}`;

    const res = await wikipediaClient.get(url);

    console.log(`\n🧪 RAW WIKIPEDIA RESPONSE FOR: ${title}`);
    console.log(JSON.stringify(res.data, null, 2));

    const text = res.data?.extract;
    if (!text) return null;

    // ---------------------------
    // FIXED PARAGRAPH-FIRST CHUNKING
    // ---------------------------
    const paragraphs = text
      .split('\n')
      .map((p: string) => p.trim())
      .filter((p: string) => p.length > 40);

    const sections: { section: string; text: string }[] = [];

    for (const paragraph of paragraphs) {
      const sentences = paragraph
        .split(/(?<=[.!?])\s+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 20);

      let buffer = '';

      for (const sentence of sentences) {
        buffer += ' ' + sentence;

        if (buffer.length > 400) {
          if (buffer.split(' ').length < 15) {
            buffer = '';
            continue;
          }

          sections.push({
            section: classifySection(buffer),
            text: `[${normalized}] ${buffer.trim()}`,
          });

          buffer = '';
        }
      }

      if (buffer.trim() && buffer.split(' ').length > 15) {
        sections.push({
          section: classifySection(buffer),
          text: `[${normalized}] ${buffer.trim()}`,
        });
      }
    }

    return {
      title: normalized,
      sourceType: 'wikipedia',
      sections,
    };
  } catch (err: any) {
    logger.warn(`Failed ${title}: ${err.message}`);
    return null;
  }
}

// ---------------------------
// MAIN
// ---------------------------
async function main() {
  logger.info('🌍 Starting ingestion...');

  const docs: Document[] = [];

  for (const country of COUNTRIES) {
    process.stdout.write(`Fetching ${country}... `);

    const doc = await fetchWikipedia(country);

    if (doc && doc.sections.length > 0) {
      docs.push(doc);
      process.stdout.write(`✓ (${doc.sections.length} sections)\n`);
    } else {
      process.stdout.write(`✗ skipped\n`);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  logger.info(`Ingesting ${docs.length} documents...`);

  const { embedText } = await import('./embedder.js');
  const { initVectorSize, ensureCollection } = await import('./vector-store.js');

  const sample = await embedText('init');
  initVectorSize(sample);
  await ensureCollection();

  await ingestDocuments(docs);

  logger.info('🎉 Done');
  process.exit(0);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
