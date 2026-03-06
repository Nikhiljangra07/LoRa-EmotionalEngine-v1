/**
 * LoRa dev bootstrap: verify environment, start Docker containers if needed, then report status.
 * Run before starting the server so npm run dev is self-healing.
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

const FALKOR_PORT = 6379;
const CHROMA_PORT = 8000;
const COMPOSE_FALKOR = 'docker-compose.falkor.yml';
const COMPOSE_CHROMA = 'docker-compose.chroma.yml';

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function runCheckDevEnv(): boolean {
  const result = spawnSync('npx', ['ts-node', 'scripts/checkDevEnv.ts'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
  });
  return result.status === 0;
}

function dockerAvailable(): boolean {
  try {
    execSync('docker --version', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function startContainers(): Promise<void> {
  const cwd = process.cwd();
  const falkorYml = path.join(cwd, COMPOSE_FALKOR);
  const chromaYml = path.join(cwd, COMPOSE_CHROMA);

  if (fs.existsSync(falkorYml)) {
    console.log('[LoRa bootstrap] Starting Falkor...');
    execSync(`docker compose -f ${COMPOSE_FALKOR} up -d`, { cwd, stdio: 'inherit' });
  }
  if (fs.existsSync(chromaYml)) {
    console.log('[LoRa bootstrap] Starting Chroma...');
    execSync(`docker compose -f ${COMPOSE_CHROMA} up -d`, { cwd, stdio: 'inherit' });
  }

  // Wait for ports to become reachable (max ~15s)
  for (let i = 0; i < 15; i++) {
    const f = await isPortOpen('127.0.0.1', FALKOR_PORT);
    const c = await isPortOpen('127.0.0.1', CHROMA_PORT);
    if (f && c) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main(): Promise<void> {
  console.log('[LoRa bootstrap] Checking dev environment...\n');
  const passed = runCheckDevEnv();

  if (passed) {
    console.log('\n[LoRa bootstrap] Environment OK.\n');
    process.exit(0);
  }

  if (!dockerAvailable()) {
    console.log('\n[LoRa bootstrap] Docker not available. Fix Docker CLI and re-run.\n');
    process.exit(1);
  }

  const falkorOpen = await isPortOpen('127.0.0.1', FALKOR_PORT);
  const chromaOpen = await isPortOpen('127.0.0.1', CHROMA_PORT);

  if (!falkorOpen || !chromaOpen) {
    console.log('\n[LoRa bootstrap] Starting Docker containers...');
    await startContainers();
  }

  console.log('\n[LoRa bootstrap] Re-checking...\n');
  const ok = runCheckDevEnv();
  if (!ok) {
    console.log('\n[LoRa bootstrap] Some checks still failing. Fix the issues above and re-run npm run dev.\n');
    process.exit(1);
  }
  console.log('\n[LoRa bootstrap] Environment OK.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
