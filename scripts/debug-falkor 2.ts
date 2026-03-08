import Redis from 'ioredis';

const url = process.env.LORA_FALKOR_URL ?? 'redis://localhost:6379';

async function main() {
  console.log('[debug-falkor] Connecting to:', url);

  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
    connectTimeout: 3000,
  });

  client.on('connect', () => console.log('[debug-falkor] EVENT: connect'));
  client.on('ready', () => console.log('[debug-falkor] EVENT: ready'));
  client.on('error', (err) => console.log('[debug-falkor] EVENT: error', err.message));
  client.on('close', () => console.log('[debug-falkor] EVENT: close'));
  client.on('end', () => console.log('[debug-falkor] EVENT: end'));

  console.log('[debug-falkor] status before connect():', client.status);

  try {
    await client.connect();
    console.log('[debug-falkor] status after connect():', client.status);
  } catch (err: any) {
    console.error('[debug-falkor] connect() threw:', err.message);
    process.exit(1);
  }

  try {
    const pong = await client.ping();
    console.log('[debug-falkor] PING result:', pong);
  } catch (err: any) {
    console.error('[debug-falkor] PING threw:', err.message);
  }

  try {
    const result = await client.call('GRAPH.QUERY', 'testgraph', 'RETURN 1');
    console.log('[debug-falkor] GRAPH.QUERY result:', JSON.stringify(result));
  } catch (err: any) {
    console.error('[debug-falkor] GRAPH.QUERY threw:', err.message);
    console.error('[debug-falkor] GRAPH.QUERY full error:', err);
  }

  // Now test with lazyConnect: false (auto-connect) like production code
  console.log('\n[debug-falkor] --- Testing lazyConnect: false ---');
  const client2 = new Redis(url, {
    lazyConnect: false,
    enableOfflineQueue: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
    connectTimeout: 3000,
  });
  client2.on('connect', () => console.log('[debug-falkor:auto] EVENT: connect'));
  client2.on('ready', () => console.log('[debug-falkor:auto] EVENT: ready'));
  client2.on('error', (err) => console.log('[debug-falkor:auto] EVENT: error', err.message));
  client2.on('close', () => console.log('[debug-falkor:auto] EVENT: close'));

  console.log('[debug-falkor:auto] status immediately:', client2.status);

  // Wait a moment for auto-connect
  await new Promise((r) => setTimeout(r, 500));
  console.log('[debug-falkor:auto] status after 500ms:', client2.status);

  try {
    const pong2 = await client2.ping();
    console.log('[debug-falkor:auto] PING result:', pong2);
  } catch (err: any) {
    console.error('[debug-falkor:auto] PING threw:', err.message);
  }

  try {
    const r2 = await client2.call('GRAPH.QUERY', 'testgraph', 'RETURN 1');
    console.log('[debug-falkor:auto] GRAPH.QUERY result:', JSON.stringify(r2));
  } catch (err: any) {
    console.error('[debug-falkor:auto] GRAPH.QUERY threw:', err.message);
  }

  // Now test with enableOfflineQueue: false (current prod-like config) 
  console.log('\n[debug-falkor] --- Testing enableOfflineQueue: false ---');
  const client3 = new Redis(url, {
    lazyConnect: false,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
    connectTimeout: 3000,
  });
  client3.on('connect', () => console.log('[debug-falkor:noqueue] EVENT: connect'));
  client3.on('ready', () => console.log('[debug-falkor:noqueue] EVENT: ready'));
  client3.on('error', (err) => console.log('[debug-falkor:noqueue] EVENT: error', err.message));

  console.log('[debug-falkor:noqueue] status immediately:', client3.status);
  await new Promise((r) => setTimeout(r, 500));
  console.log('[debug-falkor:noqueue] status after 500ms:', client3.status);

  try {
    const pong3 = await client3.ping();
    console.log('[debug-falkor:noqueue] PING result:', pong3);
  } catch (err: any) {
    console.error('[debug-falkor:noqueue] PING threw:', err.message);
  }

  client.disconnect();
  client2.disconnect();
  client3.disconnect();
  console.log('\n[debug-falkor] Done.');
}

main().catch((err) => {
  console.error('[debug-falkor] Fatal:', err);
  process.exit(1);
});
