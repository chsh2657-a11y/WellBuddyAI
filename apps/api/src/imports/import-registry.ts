import { Injectable, NotFoundException } from '@nestjs/common';
import type { ImportSpec } from './import-spec.js';

@Injectable()
export class ImportRegistry {
  private readonly specs = new Map<string, ImportSpec<unknown>>();

  register<T>(spec: ImportSpec<T>): void {
    if (this.specs.has(spec.key)) throw new Error(`이미 등록된 가져오기 스펙: ${spec.key}`);
    this.specs.set(spec.key, spec as ImportSpec<unknown>);
  }

  get(key: string): ImportSpec<unknown> {
    const spec = this.specs.get(key);
    if (!spec) throw new NotFoundException();
    return spec;
  }
}
