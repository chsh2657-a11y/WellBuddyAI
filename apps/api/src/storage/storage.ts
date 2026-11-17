import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** 파일 본문 저장소. 메타데이터는 file_objects 테이블이 가진다. */
export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export const STORAGE = Symbol('STORAGE');

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`잘못된 저장소 키: ${key}`);
  }
}

/** 개발·테스트용: 로컬 디렉터리에 저장 */
export class LocalStorageDriver implements StorageDriver {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep))
      throw new Error('저장소 경로를 벗어났습니다');
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

/** 운영용: S3 호환 저장소(AWS S3, MinIO, NCP Object Storage) */
export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    options: { endpoint?: string; region: string; accessKey?: string; secretKey?: string },
  ) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: !!options.endpoint,
      credentials:
        options.accessKey && options.secretKey
          ? { accessKeyId: options.accessKey, secretAccessKey: options.secretKey }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
