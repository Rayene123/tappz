import { embedText } from './ingest/embedder.js';

function cosine(a: number[], b: number[]) {
  let dot = 0, magA = 0, magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function test() {
  const query = "what is the capital city of Tunisia in North Africa geography";

  const qVec = await embedText(`query: ${query}`);
  const docVec = await embedText(`[Tunisia] Geography: Tunis is capital`);

  const moroccoVec = await embedText(`[Morocco] Geography: Rabat is capital`);

  console.log("Tunisia similarity:", cosine(qVec, docVec));
  console.log("Morocco similarity:", cosine(qVec, moroccoVec));
}

test();