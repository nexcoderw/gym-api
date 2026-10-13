import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';

import { REQUEST_ID_HEADER } from '../constants/api.constants.js';
import type { RequestWithContext } from '../types/request-with-context.js';

const ACCEPTED_REQUEST_ID = /^[a-zA-Z0-9._:-]{1,128}$/u;

/** Establishes a safe correlation identifier without trusting arbitrary header content. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware<RequestWithContext, Response> {
	use(request: RequestWithContext, response: Response, next: NextFunction): void {
		const suppliedId = request.header(REQUEST_ID_HEADER);
		request.requestId =
			suppliedId !== undefined && ACCEPTED_REQUEST_ID.test(suppliedId) ? suppliedId : randomUUID();
		response.setHeader(REQUEST_ID_HEADER, request.requestId);
		next();
	}
}
