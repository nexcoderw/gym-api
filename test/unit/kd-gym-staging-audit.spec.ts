import { buildAuditReport } from '../../scripts/synthetic-data/audit-kd-gym-staging.mjs';
import type { StagingAuditSnapshot } from '../../scripts/synthetic-data/audit-kd-gym-staging.mjs';

describe('KD GYM staging data audit', () => {
	it('validates synthetic counts, financial totals, status safety and historical grouping', () => {
		const report = buildAuditReport(makeSnapshot());
		expect(report).toMatchObject({
			database: 'neondb',
			members: {
				total: 824,
				synthetic: 823,
				original: 1,
				monthlyByJoinedOn: { '2025-10': 16, '2026-11': 32 },
			},
			payments: {
				confirmedRevenueRwf: '15516000',
				pendingAmountRwf: '5577000',
				monthlyByOccurredAtKigali: [
					{ month: '2026-11', status: 'CONFIRMED', count: 1, amountRwf: '12650' },
				],
			},
			reminders: {
				synthetic: 1765,
				byStatus: { SKIPPED: { count: 1765, channels: { SMS: 1765 } } },
				storedProviderAcknowledgements: 0,
			},
			overallResult: 'REVIEW_REQUIRED',
		});
		expect(report.checks).toMatchObject({
			memberCounts: true,
			paymentAmounts: true,
			allSyntheticRemindersSkipped: true,
			allSyntheticRemindersUseSms: true,
			noStoredProviderAcknowledgements: true,
		});
		expect(report.dashboardReportingDiscrepancies).toEqual([
			expect.objectContaining({
				code: 'HISTORICAL_ACTIVE_SUBSCRIBERS_USE_INSERTION_TIMESTAMPS',
				businessDateActiveSyntheticMembers: 210,
				currentDashboardActiveSyntheticMembers: 0,
			}),
		]);
	});

	it('reports data integrity failures independently from dashboard findings', () => {
		const snapshot = makeSnapshot();
		const report = buildAuditReport({
			...snapshot,
			members: { ...snapshot.members, total: 823, syntheticWrongBatch: 2 },
			payments: {
				...snapshot.payments,
				statusRows: [
					{ status: 'CONFIRMED', count: 1227, amountRwf: '100' },
					{ status: 'PENDING', count: 446, amountRwf: '5577000' },
				],
			},
			reminders: {
				...snapshot.reminders,
				statusRows: [
					{ status: 'SKIPPED', channel: 'SMS', count: 1764 },
					{ status: 'DELIVERED', channel: 'SMS', count: 1 },
				],
			},
		});
		expect(report.overallResult).toBe('FAIL');
		expect(report.dataIntegrityAnomalies).toEqual(
			expect.arrayContaining(['memberCounts', 'paymentAmounts', 'allSyntheticRemindersSkipped']),
		);
	});

	it('does not report defects when records and business-date activity agree', () => {
		const snapshot = makeSnapshot();
		const report = buildAuditReport({
			...snapshot,
			subscriptions: {
				...snapshot.subscriptions,
				dashboardTechnicalActiveMembers: snapshot.subscriptions.historicalBusinessActiveMembers,
			},
		});
		expect(report.overallResult).toBe('PASS');
		expect(report.dashboardReportingDiscrepancies).toEqual([]);
		expect(report.reportingSemantics).toMatchObject({
			pendingPaymentsIncludedInConfirmedRevenue: false,
			skippedRemindersCountedAsSuccessfulDelivery: false,
		});
	});
});

function makeSnapshot(): StagingAuditSnapshot {
	return {
		databaseName: 'neondb',
		organizationName: 'KD GYM',
		members: {
			total: 824,
			synthetic: 823,
			original: 1,
			syntheticWrongBatch: 0,
			syntheticWithoutJoiningDate: 0,
			monthlyByJoinedOn: [
				{ month: '2025-10', count: 16 },
				{ month: '2026-11', count: 32 },
			],
			monthlyByDashboardDate: [
				{ month: '2025-10', count: 16 },
				{ month: '2026-11', count: 32 },
			],
		},
		subscriptions: {
			syntheticCount: 1919,
			linkageAnomalies: 0,
			historicalBusinessActiveMembers: 210,
			dashboardTechnicalActiveMembers: 0,
			monthlyByStartDate: [{ month: '2026-11', count: 25 }],
		},
		payments: {
			organizationTotal: 1674,
			syntheticCount: 1673,
			syntheticLinkageAnomalies: 0,
			statusRows: [
				{ status: 'CONFIRMED', count: 1227, amountRwf: '15516000' },
				{ status: 'PENDING', count: 446, amountRwf: '5577000' },
			],
			monthlyByOccurredAtKigali: [
				{ month: '2026-11', status: 'CONFIRMED', count: 1, amountRwf: '12650' },
			],
			monthlyByCreatedAtKigali: [{ month: '2026-11', count: 1673 }],
		},
		allocations: { syntheticCount: 1673, linkageAnomalies: 0, coverageAnomalies: 0 },
		auditEvents: { syntheticCount: 1673, linkageAnomalies: 0, coverageAnomalies: 0 },
		reminders: {
			syntheticCount: 1765,
			providerAcknowledgementCount: 0,
			linkageAnomalies: 0,
			statusRows: [{ status: 'SKIPPED', channel: 'SMS', count: 1765 }],
			monthlyByDueDate: [{ month: '2026-11', count: 106 }],
		},
	};
}
