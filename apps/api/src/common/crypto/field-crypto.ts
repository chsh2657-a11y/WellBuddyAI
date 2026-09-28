import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * 필드 단위 암호화(AES-256-GCM). 주민등록번호·계좌번호·외부 API 자격증명 저장용.
 *
 * 저장 형식: v1:<keyId>:<iv>:<tag>:<ciphertext>  (각 값은 base64url)
 *  - keyId 로 어떤 키로 암호화했는지 기록해 키 교체(로테이션)를 지원한다.
 *  - purpose(AAD)를 함께 넣으면 다른 용도의 필드에 암호문을 옮겨 붙여도 복호화되지 않는다.
 */
export class FieldCrypto {
  private readonly keys: Map<string, Buffer>;

  constructor(
    private readonly activeKeyId: string,
    keys: Record<string, Buffer>,
  ) {
    this.keys = new Map(Object.entries(keys));
    for (const [id, key] of this.keys) {
      if (key.length !== 32) throw new Error(`암호화 키 ${id} 는 32바이트여야 합니다`);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`잘못된 키 ID: ${id}`);
    }
    if (!this.keys.has(activeKeyId)) throw new Error(`활성 키 ${activeKeyId} 가 없습니다`);
  }

  encrypt(plaintext: string, purpose = ''): string {
    const key = this.keys.get(this.activeKeyId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(purpose, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', this.activeKeyId, b64(iv), b64(tag), b64(ciphertext)].join(':');
  }

  decrypt(payload: string, purpose = ''): string {
    const parts = payload.split(':');
    if (parts.length !== 5 || parts[0] !== 'v1') throw new Error('암호문 형식이 올바르지 않습니다');
    const [, keyId, iv, tag, ciphertext] = parts as [string, string, string, string, string];
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`복호화 키(${keyId})를 찾을 수 없습니다`);
    const decipher = createDecipheriv('aes-256-gcm', key, fromB64(iv));
    decipher.setAAD(Buffer.from(purpose, 'utf8'));
    decipher.setAuthTag(fromB64(tag));
    return Buffer.concat([decipher.update(fromB64(ciphertext)), decipher.final()]).toString('utf8');
  }

  encryptJson(value: unknown, purpose = ''): string {
    return this.encrypt(JSON.stringify(value), purpose);
  }

  decryptJson<T>(payload: string, purpose = ''): T {
    return JSON.parse(this.decrypt(payload, purpose)) as T;
  }

  /** 암호문이 활성 키가 아닌 예전 키로 만들어졌는지(재암호화 대상인지) */
  needsReencrypt(payload: string): boolean {
    return payload.split(':')[1] !== this.activeKeyId;
  }

  /**
   * 검색용 블라인드 인덱스: 같은 값은 같은 해시가 되어 중복 확인·검색에 쓸 수 있지만 원문은 알 수 없다.
   * 암호화 키에서 HKDF 로 파생한 별도 키를 쓰므로 암호화 키가 그대로 노출되지 않는다.
   */
  blindIndex(value: string, purpose: string): string {
    const base = this.keys.get(this.activeKeyId)!;
    const indexKey = Buffer.from(
      hkdfSync('sha256', base, Buffer.alloc(0), `blind-index:${purpose}`, 32),
    );
    return createHmac('sha256', indexKey).update(value.normalize('NFC')).digest('hex');
  }
}

function b64(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromB64(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

/** 화면 표시용 마스킹: 앞뒤 일부만 남긴다. */
export function maskSecret(value: string, visible = 2): string {
  if (value.length <= visible * 2) return '*'.repeat(value.length);
  return `${value.slice(0, visible)}${'*'.repeat(Math.min(8, value.length - visible * 2))}${value.slice(-visible)}`;
}
