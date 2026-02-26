import { ChromaClient } from 'chromadb';

let cachedClient: ChromaClient | null = null;

function parseChromaUrl(raw: string): { host: string; port: number; ssl: boolean } {
  const parsed = new URL(raw);
  const ssl = parsed.protocol === 'https:';
  const port = parsed.port ? Number(parsed.port) : (ssl ? 443 : 8000);
  return { host: parsed.hostname, port, ssl };
}

export function getChromaClient(): ChromaClient {
  const url = process.env.LORA_CHROMA_URL;
  if (!url) {
    throw new Error('LORA_CHROMA_URL is not set');
  }
  if (!cachedClient) {
    const { host, port, ssl } = parseChromaUrl(url);
    cachedClient = new ChromaClient({ host, port, ssl });
  }
  return cachedClient;
}

export function resetChromaClient(): void {
  cachedClient = null;
}
