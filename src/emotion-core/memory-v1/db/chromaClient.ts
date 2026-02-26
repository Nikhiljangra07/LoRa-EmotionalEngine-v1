import { ChromaClient } from 'chromadb';

let cachedClient: ChromaClient | null = null;

export function getChromaClient(): ChromaClient {
  const url = process.env.LORA_CHROMA_URL;
  if (!url) {
    throw new Error('LORA_CHROMA_URL is not set');
  }
  if (!cachedClient) {
    cachedClient = new ChromaClient({ path: url });
  }
  return cachedClient;
}

export function resetChromaClient(): void {
  cachedClient = null;
}
