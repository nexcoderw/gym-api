import { ORGANIZATION_ENTITLEMENT } from '@nexcoderw/gym-db';

import { OwnerDashboardAnalyticsController } from '../../src/modules/owner/dashboard/owner-dashboard-analytics.controller.js';
import { OWNER_ENTITLEMENTS_METADATA } from '../../src/modules/owner/entitlements/owner-entitlement.constants.js';
import { OwnerMembershipPlansController } from '../../src/modules/owner/membership-plans/owner-membership-plans.controller.js';
import { OwnerMembersController } from '../../src/modules/owner/members/owner-members.controller.js';
import { OwnerPaymentsController } from '../../src/modules/owner/payments/owner-payments.controller.js';
import { OwnerReminderActivityController } from '../../src/modules/owner/reminders/owner-reminder-activity.controller.js';
import { OwnerPaymentReportsController } from '../../src/modules/owner/reports/owner-payment-reports.controller.js';

type ControllerPrototype = Record<string, unknown>;

describe('owner operation entitlement declarations', () => {
	it.each([
		[OwnerDashboardAnalyticsController.prototype, 'get', [ORGANIZATION_ENTITLEMENT.dashboardRead]],
		[
			OwnerMembershipPlansController.prototype,
			'list',
			[ORGANIZATION_ENTITLEMENT.membershipPlansRead],
		],
		[
			OwnerMembershipPlansController.prototype,
			'get',
			[ORGANIZATION_ENTITLEMENT.membershipPlansRead],
		],
		[
			OwnerMembershipPlansController.prototype,
			'create',
			[ORGANIZATION_ENTITLEMENT.membershipPlansManage],
		],
		[
			OwnerMembershipPlansController.prototype,
			'update',
			[ORGANIZATION_ENTITLEMENT.membershipPlansManage],
		],
		[
			OwnerMembershipPlansController.prototype,
			'archive',
			[ORGANIZATION_ENTITLEMENT.membershipPlansManage],
		],
		[OwnerMembersController.prototype, 'list', [ORGANIZATION_ENTITLEMENT.membersRead]],
		[OwnerMembersController.prototype, 'get', [ORGANIZATION_ENTITLEMENT.membersRead]],
		[
			OwnerMembersController.prototype,
			'create',
			[ORGANIZATION_ENTITLEMENT.membersCreate, ORGANIZATION_ENTITLEMENT.memberSubscriptionsManage],
		],
		[OwnerMembersController.prototype, 'update', [ORGANIZATION_ENTITLEMENT.membersUpdate]],
		[OwnerMembersController.prototype, 'archive', [ORGANIZATION_ENTITLEMENT.membersArchive]],
		[
			OwnerMembersController.prototype,
			'subscriptions',
			[ORGANIZATION_ENTITLEMENT.memberSubscriptionsRead],
		],
		[
			OwnerMembersController.prototype,
			'renew',
			[ORGANIZATION_ENTITLEMENT.memberSubscriptionsManage],
		],
		[
			OwnerMembersController.prototype,
			'cancel',
			[ORGANIZATION_ENTITLEMENT.memberSubscriptionsManage],
		],
		[OwnerPaymentsController.prototype, 'list', [ORGANIZATION_ENTITLEMENT.paymentsRead]],
		[OwnerPaymentsController.prototype, 'get', [ORGANIZATION_ENTITLEMENT.paymentsRead]],
		[OwnerPaymentsController.prototype, 'create', [ORGANIZATION_ENTITLEMENT.paymentsCreate]],
		[
			OwnerPaymentsController.prototype,
			'registerPayment',
			[
				ORGANIZATION_ENTITLEMENT.paymentsCreate,
				ORGANIZATION_ENTITLEMENT.membersCreate,
				ORGANIZATION_ENTITLEMENT.memberSubscriptionsManage,
			],
		],
		[OwnerPaymentsController.prototype, 'void', [ORGANIZATION_ENTITLEMENT.paymentsVoid]],
		[OwnerPaymentsController.prototype, 'refund', [ORGANIZATION_ENTITLEMENT.paymentsRefund]],
		[OwnerReminderActivityController.prototype, 'list', [ORGANIZATION_ENTITLEMENT.remindersRead]],
		[
			OwnerReminderActivityController.prototype,
			'upcoming',
			[ORGANIZATION_ENTITLEMENT.remindersRead],
		],
		[
			OwnerReminderActivityController.prototype,
			'queueManual',
			[ORGANIZATION_ENTITLEMENT.remindersSend],
		],
		[OwnerPaymentReportsController.prototype, 'summary', [ORGANIZATION_ENTITLEMENT.reportsRead]],
		[
			OwnerPaymentReportsController.prototype,
			'pdf',
			[ORGANIZATION_ENTITLEMENT.reportsRead, ORGANIZATION_ENTITLEMENT.reportsExport],
		],
	] as const)('declares the exact policy for %p.%s', (prototype, method, expected) => {
		const handler = (prototype as unknown as ControllerPrototype)[method];
		expect(typeof handler).toBe('function');
		expect(Reflect.getMetadata(OWNER_ENTITLEMENTS_METADATA, handler as object)).toEqual(expected);
	});
});
