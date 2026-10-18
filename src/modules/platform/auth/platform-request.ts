import type { RequestWithContext } from '../../../common/types/request-with-context.js';
import type { PlatformPrincipal } from './platform-auth.types.js';

export interface PlatformRequest extends RequestWithContext {
	platformPrincipal?: PlatformPrincipal;
}
