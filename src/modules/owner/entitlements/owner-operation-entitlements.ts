import { ORGANIZATION_ENTITLEMENT } from '@nexcoderw/gym-db';

/**
 * Endpoint-to-entitlement policy for authenticated organization-owner operations.
 *
 * Keep compound commands explicit: every capability whose state can be changed by
 * one request must be enabled for the organization.
 */
export const OWNER_OPERATION_ENTITLEMENTS = {
	dashboardAnalyticsRead: [ORGANIZATION_ENTITLEMENT.dashboardRead],
	membershipPlansList: [ORGANIZATION_ENTITLEMENT.membershipPlansRead],
	membershipPlansGet: [ORGANIZATION_ENTITLEMENT.membershipPlansRead],
	membershipPlansCreate: [ORGANIZATION_ENTITLEMENT.membershipPlansManage],
	membershipPlansUpdate: [ORGANIZATION_ENTITLEMENT.membershipPlansManage],
	membershipPlansArchive: [ORGANIZATION_ENTITLEMENT.membershipPlansManage],
	membersList: [ORGANIZATION_ENTITLEMENT.membersRead],
	membersGet: [ORGANIZATION_ENTITLEMENT.membersRead],
	membersCreateWithSubscription: [
		ORGANIZATION_ENTITLEMENT.membersCreate,
		ORGANIZATION_ENTITLEMENT.memberSubscriptionsManage,
	],
	membersUpdate: [ORGANIZATION_ENTITLEMENT.membersUpdate],
	membersArchive: [ORGANIZATION_ENTITLEMENT.membersArchive],
	memberSubscriptionsList: [ORGANIZATION_ENTITLEMENT.memberSubscriptionsRead],
	memberSubscriptionsCreate: [ORGANIZATION_ENTITLEMENT.memberSubscriptionsManage],
	memberSubscriptionsCancel: [ORGANIZATION_ENTITLEMENT.memberSubscriptionsManage],
	paymentsList: [ORGANIZATION_ENTITLEMENT.paymentsRead],
	paymentsGet: [ORGANIZATION_ENTITLEMENT.paymentsRead],
	paymentsCreate: [ORGANIZATION_ENTITLEMENT.paymentsCreate],
	paymentRegistrationCreate: [
		ORGANIZATION_ENTITLEMENT.paymentsCreate,
		ORGANIZATION_ENTITLEMENT.membersCreate,
		ORGANIZATION_ENTITLEMENT.memberSubscriptionsManage,
	],
	paymentsVoid: [ORGANIZATION_ENTITLEMENT.paymentsVoid],
	paymentsRefund: [ORGANIZATION_ENTITLEMENT.paymentsRefund],
	remindersActivityRead: [ORGANIZATION_ENTITLEMENT.remindersRead],
	remindersUpcomingRead: [ORGANIZATION_ENTITLEMENT.remindersRead],
	remindersSend: [ORGANIZATION_ENTITLEMENT.remindersSend],
	paymentReportsRead: [ORGANIZATION_ENTITLEMENT.reportsRead],
	paymentReportsExport: [
		ORGANIZATION_ENTITLEMENT.reportsRead,
		ORGANIZATION_ENTITLEMENT.reportsExport,
	],
} as const;

