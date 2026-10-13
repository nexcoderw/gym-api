import { ConflictException } from '@nestjs/common';
import { OrganizationStatus } from '@nexcoderw/gym-db';

export type OrganizationLifecycleAction = 'activation' | 'suspension';

export function lifecycleStatus(
	current: OrganizationStatus,
	action: OrganizationLifecycleAction,
): OrganizationStatus {
	if (
		action === 'activation' &&
		(current === OrganizationStatus.PENDING || current === OrganizationStatus.SUSPENDED)
	) {
		return OrganizationStatus.ACTIVE;
	}
	if (action === 'suspension' && current === OrganizationStatus.ACTIVE) {
		return OrganizationStatus.SUSPENDED;
	}
	throw new ConflictException({
		code: 'ORGANIZATION_TRANSITION_CONFLICT',
		message: 'The organization does not permit this lifecycle transition',
	});
}
