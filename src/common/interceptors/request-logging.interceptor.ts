import {
	CallHandler,
	ExecutionContext,
	Injectable,
	Logger,
	type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { type Observable, finalize } from 'rxjs';

import type { RequestWithContext } from '../types/request-with-context';

/** Logs bounded request metadata while excluding bodies, credentials, and query values. */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
	private readonly logger = new Logger(RequestLoggingInterceptor.name);

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const http = context.switchToHttp();
		const request = http.getRequest<RequestWithContext>();
		const response = http.getResponse<Response>();
		const startedAt = performance.now();

		return next.handle().pipe(
			finalize(() => {
				const durationMilliseconds = Math.round(performance.now() - startedAt);
				this.logger.log(
					`${request.method} ${request.path} ${String(response.statusCode)} ${String(durationMilliseconds)}ms requestId=${request.requestId}`,
				);
			}),
		);
	}
}
