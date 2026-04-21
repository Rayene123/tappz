import axios from 'axios';

/**
 * Generates an embedding vector for a given text using OpenAI API.
 * Replace with Ollama or other provider if needed.
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      input: text,
      model: 'text-embedding-3-small', // or your chosen model
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );
  return response.data.data[0].embedding;
}