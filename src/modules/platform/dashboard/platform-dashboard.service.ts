import { Injectable } from '@nestjs/common';
import { PlatformStaffStatus, Prisma, PrismaService } from '@nexcoderw/gym-db';

import type {
	PlatformDashboardMetricsQueryDto,
	PlatformDashboardMetricsResponseDto,
} from './dto/platform-dashboard-metrics.dto.js';
import type { PlatformDashboardSummaryDto } from './dto/platform-dashboard-summary.dto.js';
import {
	platformDashboardChange,
	resolvePlatformDashboardPeriod,
} from './platform-dashboard-metrics.policy.js';

@Injectable()
export class PlatformDashboardService {
	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Reads four aggregates from one repeatable-read snapshot on the existing database client.
	 * generatedAt describes response generation, not the exact snapshot acquisition time.
	 * Persistence failures propagate to the centralized safe HTTP exception boundary.
	 */
	async getSummary(): Promise<PlatformDashboardSummaryDto> {
		const staffGroupByArgs = {
			by: ['status'],
			orderBy: { status: 'asc' },
			_count: { _all: true },
		} satisfies Prisma.PlatformStaffGroupByArgs;
		// Infer the exact aggregate payload before the transaction's tuple context widens it.
		// Prisma promises are lazy: this query still executes only inside the transaction.
		const staffStatusQuery = this.prisma.platformStaff.groupBy(staffGroupByArgs);
		const [users, staffGroups, roles, permissions] = await this.prisma.$transaction(
			[
				this.prisma.user.count(),
				staffStatusQuery,
				this.prisma.platformRole.count(),
				this.prisma.platformPermission.count(),
			],
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
		);
		const staffCounts: Record<PlatformStaffStatus, number> = {
			[PlatformStaffStatus.PENDING]: 0,
			[PlatformStaffStatus.ACTIVE]: 0,
			[PlatformStaffStatus.SUSPENDED]: 0,
			[PlatformStaffStatus.REVOKED]: 0,
		};
		let staffTotal = 0;
		for (const group of staffGroups) {
			staffCounts[group.status] = group._count._all;
			staffTotal += group._count._all;
		}

		return {
			generatedAt: new Date().toISOString(),
			globalUsers: { total: users },
			platformStaff: {
				total: staffTotal,
				pending: staffCounts[PlatformStaffStatus.PENDING],
				active: staffCounts[PlatformStaffStatus.ACTIVE],
				suspended: staffCounts[PlatformStaffStatus.SUSPENDED],
				revoked: staffCounts[PlatformStaffStatus.REVOKED],
			},
			platformRoles: { total: roles },
			platformPermissions: { total: permissions },
		};
	}

	/** Reads only aggregate organization counts from one repeatable-read snapshot. */
	async getMetrics(
		query: Readonly<PlatformDashboardMetricsQueryDto>,
		now = new Date(),
	): Promise<PlatformDashboardMetricsResponseDto> {
		const resolved = resolvePlatformDashboardPeriod(query, now);
		const selected =
			resolved.selected === null
				? this.prisma.organization.count()
				: this.prisma.organization.count({ where: { createdAt: resolved.selected } });
		const operations =
			resolved.comparison === null
				? [selected]
				: [
						selected,
						this.prisma.organization.count({
							where: { createdAt: resolved.comparison },
						}),
					];
		const counts = await this.prisma.$transaction(operations, {
			isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
		});
		const current = counts[0] ?? 0;
		const previous = counts[1] ?? null;
		return {
			generatedAt: now.toISOString(),
			period: resolved.period,
			metrics: {
				organizations: {
					current,
					previous,
					change: platformDashboardChange(current, previous),
				},
			},
		};
	}
}
