import type { RequestWithContext } from '../../../common/types/request-with-context.js';
import type { OwnerPrincipal } from './owner-auth.types.js';

export interface OwnerRequest extends RequestWithContext {
	ownerPrincipal?: OwnerPrincipal;
	ownerOrganizationSlug?: string;
}
