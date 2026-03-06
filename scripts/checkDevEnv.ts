/**
 * LoRa dev environment checker.
 * Verifies Docker CLI, Docker daemon, Falkor (6379), Chroma (8000), and required env vars.
 * Exit code: 0 if all critical checks pass, non-zero otherwise.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as dotenv from 'dotenv';

const FALKOR_PORT = 6379;
const CHROMA_PORT = 8000;
const REQUIRED_ENV_VARS = ['LORA_FALKOR_URL', 'LORA_CHROMA_URL'];

function loadEnv(): void {
  const cwd = process.cwd();
  dotenv.config({ path: path.join(cwd, '.env.local') });
  dotenv.config({ path: path.join(cwd, '.env') });
}

function logCheck(name: string, ok: boolean, fix?: string): boolean {
  const symbol = ok ? '✔' : '✖';
  console.log(`${symbol} ${name}`);
  if (!ok && fix) {
    console.log(`   Fix: ${fix}`);
  }
  return ok;
}

function dockerCliAvailable(): boolean {
  try {
    execSync('docker --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function dockerDaemonRunning(): boolean {
  try {
    execSync('docker info', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    const timeout = 2000;
    socket.setTimeout(timeout);
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

function envVarsPresent(): boolean {
  for (const key of REQUIRED_ENV_VARS) {
    const val = process.env[key];
    if (!val || typeof val !== 'string' || !val.trim()) return false;
  }
  return true;
}

function envVarsInFile(): boolean {
  const cwd = process.cwd();
  const envLocalPath = path.join(cwd, '.env.local');
  if (!fs.existsSync(envLocalPath)) return false;
  const content = fs.readFileSync(envLocalPath, 'utf-8');
  for (const key of REQUIRED_ENV_VARS) {
    if (!content.includes(key + '=')) return false;
  }
  return true;
}

async function run(): Promise<number> {
  loadEnv();

  const dockerCli = logCheck(
    'Docker CLI detected',
    dockerCliAvailable(),
    'Restart terminal or reinstall Docker Desktop. Run: npm run docker:path-fix'
  );

  const dockerDaemon = logCheck(
    'Docker daemon running',
    dockerCli && dockerDaemonRunning(),
    'Start Docker Desktop and wait until it is ready.'
  );

  const falkorOk = await isPortOpen('127.0.0.1', FALKOR_PORT);
  logCheck(
    `Falkor reachable (${FALKOR_PORT})`,
    falkorOk,
    'Run: npm run falkor:start'
  );

  const chromaOk = await isPortOpen('127.0.0.1', CHROMA_PORT);
  logCheck(
    `Chroma reachable (${CHROMA_PORT})`,
    chromaOk,
    'Run: npm run chroma:start'
  );

  const envLoaded = envVarsPresent();
  const envInFile = envVarsInFile();
  const envOk = envLoaded || envInFile;
  if (!envOk) {
    logCheck(
      'Environment variables loaded',
      false,
      'Add LORA_FALKOR_URL and LORA_CHROMA_URL to .env.local (e.g. redis://127.0.0.1:6379 and http://127.0.0.1:8000).'
    );
  } else {
    logCheck('Environment variables loaded', true);
  }

  const critical = dockerCli && dockerDaemon && falkorOk && chromaOk && envOk;
  return critical ? 0 : 1;
}

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
