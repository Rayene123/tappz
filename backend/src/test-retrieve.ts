import { retrieveChunks } from './rag/retriever.js';

async function test() {
  const results = await retrieveChunks("capital of Tunisia");

  console.log("RESULTS:");
  console.log(
    results.map(r => ({
      title: r.sourceTitle,
      text: r.text.slice(0, 100),
    }))
  );
}

test();