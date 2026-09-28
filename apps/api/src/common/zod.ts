import {
  applyDecorators,
  type ArgumentMetadata,
  Body,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  type PipeTransform,
  Param,
  Query,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';

/** zod 스키마 → OpenAPI 3.0 스키마 객체 */
export function toOpenApi(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' });
  delete (json as Record<string, unknown>).$schema;
  return json as Record<string, unknown>;
}

/** 요청 값을 zod 로 검증·변환한다. 실패하면 ZodError 를 던지고 예외 필터가 400 으로 바꾼다. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.output<T> {
    return this.schema.parse(value);
  }
}

type AnyDecorator = (
  target: object,
  key?: string | symbol,
  descriptor?: PropertyDescriptor,
) => void;

function applyMethodDecorator(decorator: AnyDecorator, target: object, key: string | symbol) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  decorator(target, key, descriptor);
}

/** @Body() + zod 검증 + Swagger 요청 본문 스키마 */
export function ZodBody(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    Body(new ZodValidationPipe(schema))(target, key, index);
    if (key !== undefined) {
      applyMethodDecorator(
        ApiBody({ schema: toOpenApi(schema, 'input') }) as AnyDecorator,
        target,
        key,
      );
    }
  };
}

/** @Query() + zod 검증 + Swagger 쿼리 파라미터 */
export function ZodQuery(schema: z.ZodObject): ParameterDecorator {
  return (target, key, index) => {
    Query(new ZodValidationPipe(schema))(target, key, index);
    if (key === undefined) return;
    for (const [name, field] of Object.entries(schema.shape)) {
      const fieldSchema = field as z.ZodType;
      applyMethodDecorator(
        ApiQuery({
          name,
          required: !fieldSchema.safeParse(undefined).success,
          schema: toOpenApi(fieldSchema, 'input'),
        }) as AnyDecorator,
        target,
        key,
      );
    }
  };
}

const RESPONSE_SCHEMA = 'wellbuddy:zod-response';

/**
 * 응답 스키마를 Swagger 에 기록하고, 실제 응답도 이 스키마로 걸러낸다.
 * (정의되지 않은 필드는 제거되므로 비밀번호 해시 같은 내부 값이 새어 나가지 않는다.)
 */
export function ZodResponse(
  schema: z.ZodType,
  options: { status?: number; description?: string } = {},
) {
  return applyDecorators(
    SetMetadata(RESPONSE_SCHEMA, schema),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description ?? 'OK',
      schema: toOpenApi(schema, 'output'),
    }),
  );
}

@Injectable()
export class ZodSerializerInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<z.ZodType | undefined>(RESPONSE_SCHEMA, context.getHandler());
    if (!schema) return next.handle();
    return next.handle().pipe(map((value) => schema.parse(value)));
  }
}

/** 경로 파라미터 UUID 검증 */
export function UuidParam(name: string): ParameterDecorator {
  return Param(name, new ZodValidationPipe(z.uuid({ error: '잘못된 ID 형식입니다.' })));
}
