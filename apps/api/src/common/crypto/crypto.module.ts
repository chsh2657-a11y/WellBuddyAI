import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { FieldCrypto } from './field-crypto.js';

@Global()
@Module({
  providers: [
    {
      provide: FieldCrypto,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new FieldCrypto(config.fieldEncryption.keyId, {
          ...config.fieldEncryption.previousKeys,
          [config.fieldEncryption.keyId]: config.fieldEncryption.key,
        }),
    },
  ],
  exports: [FieldCrypto],
})
export class CryptoModule {}
