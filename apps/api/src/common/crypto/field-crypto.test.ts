import { describe, expect, it } from 'vitest';
import { FieldCrypto, maskSecret } from './field-crypto.js';

const k1 = Buffer.alloc(32, 1);
const k2 = Buffer.alloc(32, 2);

describe('FieldCrypto (AES-256-GCM)', () => {
  const crypto = new FieldCrypto('k1', { k1 });

  it('암호화한 값을 복호화하면 원문이 나온다', () => {
    const encrypted = crypto.encrypt('900101-1234567', 'resident-no');
    expect(encrypted).toMatch(/^v1:k1:/);
    expect(encrypted).not.toContain('900101');
    expect(crypto.decrypt(encrypted, 'resident-no')).toBe('900101-1234567');
  });

  it('같은 값도 매번 다른 암호문이 된다(IV 무작위)', () => {
    expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
  });

  it('암호문을 변조하면 복호화에 실패한다', () => {
    const parts = crypto.encrypt('secret').split(':');
    const ct = Buffer.from(parts[4]!, 'base64url');
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString('base64url');
    expect(() => crypto.decrypt(parts.join(':'))).toThrow();
  });

  it('다른 용도(AAD)로는 복호화할 수 없다', () => {
    const encrypted = crypto.encrypt('secret', 'integration:bank');
    expect(() => crypto.decrypt(encrypted, 'integration:card')).toThrow();
  });

  it('다른 키로는 복호화할 수 없다', () => {
    const encrypted = crypto.encrypt('secret');
    const other = new FieldCrypto('k1', { k1: k2 });
    expect(() => other.decrypt(encrypted)).toThrow();
  });

  it('키를 교체해도 예전 키로 만든 암호문을 읽을 수 있다', () => {
    const old = crypto.encrypt('legacy');
    const rotated = new FieldCrypto('k2', { k1, k2 });
    expect(rotated.decrypt(old)).toBe('legacy');
    expect(rotated.needsReencrypt(old)).toBe(true);
    expect(rotated.encrypt('new')).toMatch(/^v1:k2:/);
  });

  it('JSON 값을 암호화할 수 있다', () => {
    const encrypted = crypto.encryptJson({ id: 'user', password: 'pw' }, 'cred');
    expect(crypto.decryptJson(encrypted, 'cred')).toEqual({ id: 'user', password: 'pw' });
  });

  it('블라인드 인덱스는 같은 값에 같은 해시, 용도가 다르면 다른 해시', () => {
    expect(crypto.blindIndex('9001011234567', 'rrn')).toBe(
      crypto.blindIndex('9001011234567', 'rrn'),
    );
    expect(crypto.blindIndex('9001011234567', 'rrn')).not.toBe(
      crypto.blindIndex('9001011234567', 'account'),
    );
  });

  it('잘못된 키 설정은 거부한다', () => {
    expect(() => new FieldCrypto('k1', { k1: Buffer.alloc(16) })).toThrow();
    expect(() => new FieldCrypto('k9', { k1 })).toThrow();
  });

  it('마스킹', () => {
    expect(maskSecret('abcdefghij')).toBe('ab******ij');
    expect(maskSecret('abc')).toBe('***');
  });
});
