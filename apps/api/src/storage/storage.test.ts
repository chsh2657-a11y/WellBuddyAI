import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertSafeKey, LocalStorageDriver } from './storage.js';

describe('LocalStorageDriver', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-storage-'));
  const storage = new LocalStorageDriver(root);
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('저장·읽기·삭제', async () => {
    await storage.put('c1/2026/09/a.bin', Buffer.from('hello'));
    expect((await storage.get('c1/2026/09/a.bin')).toString()).toBe('hello');
    await storage.delete('c1/2026/09/a.bin');
    await expect(storage.get('c1/2026/09/a.bin')).rejects.toThrow();
  });

  it('저장소 밖 경로(경로 조작)를 막는다', async () => {
    expect(() => assertSafeKey('../etc/passwd')).toThrow();
    expect(() => assertSafeKey('a/../../b')).toThrow();
    expect(() => assertSafeKey('/abs')).toThrow();
    await expect(storage.put('a//b', Buffer.from(''))).rejects.toThrow();
  });
});
