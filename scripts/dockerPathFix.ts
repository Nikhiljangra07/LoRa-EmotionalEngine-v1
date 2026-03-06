/**
 * Docker CLI path fix for macOS: if docker is not in PATH, add Docker Desktop's bin to ~/.zshrc.
 * Run when Docker Desktop is installed but `docker` is not available in new terminals.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DOCKER_APP_PATH = '/Applications/Docker.app/Contents/Resources/bin/docker';
const PATH_LINE = 'export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"';

function dockerInPath(): boolean {
  try {
    execSync('docker --version', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  if (dockerInPath()) {
    console.log('Docker CLI is already available in PATH.');
    process.exit(0);
  }

  if (!fs.existsSync(DOCKER_APP_PATH)) {
    console.error('Docker binary not found at:', DOCKER_APP_PATH);
    console.error('Install Docker Desktop from https://www.docker.com/products/docker-desktop');
    process.exit(1);
  }

  const zshrc = path.join(os.homedir(), '.zshrc');
  let content = '';
  if (fs.existsSync(zshrc)) {
    content = fs.readFileSync(zshrc, 'utf-8');
  }

  if (content.includes('Docker.app/Contents/Resources/bin')) {
    console.log('Docker path already present in ~/.zshrc.');
    console.log('Restart your terminal or run: source ~/.zshrc');
    process.exit(0);
  }

  const append = content.endsWith('\n') ? PATH_LINE : '\n' + PATH_LINE;
  fs.appendFileSync(zshrc, append + '\n');
  console.log('Added Docker to PATH in ~/.zshrc.');
  console.log('Restart your terminal (or run: source ~/.zshrc) and try again.');
  process.exit(0);
}

main();
