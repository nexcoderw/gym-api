import {
	ArgumentsHost,
	Catch,
	HttpException,
	Logger,
	type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import type { RequestWithContext } from '../types/request-with-context';

const STATUS_CODES: Readonly<Record<number, string>> = {
	400: 'BAD_REQUEST',
	401: 'UNAUTHENTICATED',
	403: 'FORBIDDEN',
	404: 'NOT_FOUND',
	409: 'CONFLICT',
	429: 'RATE_LIMITED',
};
const INTERNAL_SERVER_ERROR_STATUS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger(ApiExceptionFilter.name);

	catch(exception: unknown, host: ArgumentsHost): void {
		const http = host.switchToHttp();
		const request = http.getRequest<RequestWithContext>();
		const response = http.getResponse<Response>();
		const status = exception instanceof HttpException ? exception.getStatus() : 500;
		const exceptionBody = exception instanceof HttpException ? exception.getResponse() : undefined;
		const bodyRecord = isRecord(exceptionBody) ? exceptionBody : undefined;
		const code =
			typeof bodyRecord?.code === 'string'
				? bodyRecord.code
				: (STATUS_CODES[status] ?? 'INTERNAL_ERROR');
		const messageValue = bodyRecord?.message;
		const message =
			status >= INTERNAL_SERVER_ERROR_STATUS
				? 'An unexpected error occurred'
				: typeof exceptionBody === 'string'
					? exceptionBody
					: typeof messageValue === 'string'
						? messageValue
						: 'Request failed';

		if (status >= INTERNAL_SERVER_ERROR_STATUS) {
			this.logger.error(
				`${request.method} ${request.path} failed requestId=${request.requestId}`,
				exception instanceof Error ? exception.stack : undefined,
			);
		}

		response.status(status).json({
			error: {
				code,
				message,
				requestId: request.requestId,
				...(Array.isArray(bodyRecord?.details) ? { details: bodyRecord.details } : {}),
			},
			timestamp: new Date().toISOString(),
			path: request.path,
		});
	}
}
