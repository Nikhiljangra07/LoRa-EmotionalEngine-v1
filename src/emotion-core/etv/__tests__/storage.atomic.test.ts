import { ETVStorage } from '../storage';
import * as fs from 'fs';
import * as path from 'path';

const ETV_DIR = path.resolve(process.cwd(), '.lora', 'etv');

function userPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(ETV_DIR, `${safe}.json`);
}

function cleanStorage(userId: string) {
  const fp = userPath(userId);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  const tmp = fp + '.tmp';
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
}

const TEST_USER = 'atomic_test_user';

beforeEach(() => cleanStorage(TEST_USER));
afterAll(() => cleanStorage(TEST_USER));

describe('ETVStorage atomic writes', () => {
  test('save creates file that load can read back', () => {
    const state = ETVStorage.initState(TEST_USER);
    ETVStorage.save(state);
    const loaded = ETVStorage.load(TEST_USER);
    expect(loaded).not.toBeNull();
    expect(loaded!.userId).toBe(TEST_USER);
    expect(loaded!.r).toBe(state.r);
    expect(loaded!.s).toBe(state.s);
  });

  test('no .tmp file remains after successful save', () => {
    const state = ETVStorage.initState(TEST_USER);
    ETVStorage.save(state);
    const tmp = userPath(TEST_USER) + '.tmp';
    expect(fs.existsSync(tmp)).toBe(false);
  });

  test('save overwrites previous state', () => {
    const state1 = { ...ETVStorage.initState(TEST_USER), r: 5.0, s: 3.0 };
    ETVStorage.save(state1);

    const state2 = { ...state1, r: 8.0, s: 2.0 };
    ETVStorage.save(state2);

    const loaded = ETVStorage.load(TEST_USER);
    expect(loaded!.r).toBe(8.0);
    expect(loaded!.s).toBe(2.0);
  });

  test('load returns null for non-existent user', () => {
    expect(ETVStorage.load('no_such_user_xyz')).toBeNull();
  });

  test('load returns null for corrupt JSON', () => {
    const fp = userPath(TEST_USER);
    if (!fs.existsSync(ETV_DIR)) fs.mkdirSync(ETV_DIR, { recursive: true });
    fs.writeFileSync(fp, '{{not valid json}}', 'utf-8');
    expect(ETVStorage.load(TEST_USER)).toBeNull();
  });

  test('load returns null for invalid state (r <= 0)', () => {
    const fp = userPath(TEST_USER);
    if (!fs.existsSync(ETV_DIR)) fs.mkdirSync(ETV_DIR, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({
      userId: TEST_USER, r: 0, s: 1, lastSessionEndedAt: 0, updatedAt: 0,
    }), 'utf-8');
    expect(ETVStorage.load(TEST_USER)).toBeNull();
  });

  test('initState returns valid prior', () => {
    const state = ETVStorage.initState(TEST_USER);
    expect(state.r).toBeGreaterThan(0);
    expect(state.s).toBeGreaterThan(0);
    expect(state.userId).toBe(TEST_USER);
  });
});
