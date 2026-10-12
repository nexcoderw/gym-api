import type { Request } from 'express';

/** Express request enriched only with server-established request context. */
export interface RequestWithContext extends Request {
	requestId: string;
}
