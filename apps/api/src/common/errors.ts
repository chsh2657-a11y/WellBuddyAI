import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** API 오류 응답 형식 */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

/** 업무 규칙 위반 등 사용자에게 보여줄 메시지를 가진 오류 */
export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

const DEFAULT_MESSAGES: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', '요청이 올바르지 않습니다.'],
  401: ['UNAUTHORIZED', '로그인이 필요합니다.'],
  403: ['FORBIDDEN', '이 작업을 할 권한이 없습니다.'],
  404: ['NOT_FOUND', '요청한 대상을 찾을 수 없습니다.'],
  409: ['CONFLICT', '이미 처리되었거나 충돌하는 요청입니다.'],
  413: ['PAYLOAD_TOO_LARGE', '파일 또는 요청이 너무 큽니다.'],
  429: ['TOO_MANY_REQUESTS', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'],
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof ZodError) {
      return {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: '입력값을 확인해 주세요.',
        details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        ...(exception.details === undefined ? {} : { details: exception.details }),
      };
    }
    if (exception instanceof ThrottlerException) {
      const [code, message] = DEFAULT_MESSAGES[429]!;
      return { statusCode: 429, code, message };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const [code, message] = DEFAULT_MESSAGES[status] ?? ['ERROR', exception.message];
      return { statusCode: status, code, message };
    }
    return {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    };
  }
}
