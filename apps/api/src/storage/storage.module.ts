import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { LocalStorageDriver, S3StorageDriver, STORAGE } from './storage.js';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.storage.driver === 's3'
          ? new S3StorageDriver(config.storage.s3.bucket, config.storage.s3)
          : new LocalStorageDriver(config.storage.localDir),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
