import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { OrganizationStatus, Prisma } from '@nexcoderw/gym-db';

export interface OrganizationMutationContext {
	readonly actorPlatformStaffId: string;
	readonly requestId: string;
}

export interface OrganizationAuditEvent extends OrganizationMutationContext {
	readonly action: 'create' | 'update' | 'activation' | 'suspension';
	readonly organizationId: string;
	readonly occurredAt: Date;
	readonly previousStatus: OrganizationStatus | null;
	readonly resultingStatus: OrganizationStatus;
	readonly changedFields: readonly string[];
}

/** A future provider must append durable events using the supplied mutation transaction. */
export abstract class PlatformOrganizationAudit {
	abstract assertAvailable(): void;
	abstract record(
		transaction: Prisma.TransactionClient,
		event: OrganizationAuditEvent,
	): Promise<void>;
}

@Injectable()
export class UnavailableOrganizationAudit extends PlatformOrganizationAudit {
	override assertAvailable(): void {
		throw auditUnavailable();
	}

	override record(): Promise<void> {
		return Promise.reject(auditUnavailable());
	}
}

function auditUnavailable(): ServiceUnavailableException {
	return new ServiceUnavailableException({
		code: 'ORGANIZATION_AUDIT_UNAVAILABLE',
		message: 'Durable organization auditing is not available',
	});
}
