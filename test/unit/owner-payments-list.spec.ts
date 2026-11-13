import { describe, expect, it } from '@jest/globals';

import {
	ListPaymentsQueryDto,
	PaymentOrder,
} from '../../src/modules/owner/payments/dto/list-payments-query.dto.js';
import { paymentWhere } from '../../src/modules/owner/payments/owner-payments.service.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const FIRST_PLAN_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_PLAN_ID = '33333333-3333-4333-8333-333333333333';

describe('owner payment plan filtering', () => {
	it('keeps plan matching inside the organization-scoped database query', () => {
		const query = new ListPaymentsQueryDto();
		query.order = PaymentOrder.NEWEST;
		query.membershipPlanIds = [FIRST_PLAN_ID, SECOND_PLAN_ID];

		expect(paymentWhere(ORGANIZATION_ID, query)).toEqual({
			organizationId: ORGANIZATION_ID,
			allocations: {
				some: {
					memberSubscription: {
						is: { membershipPlanId: { in: [FIRST_PLAN_ID, SECOND_PLAN_ID] } },
					},
				},
			},
		});
	});

	it('leaves the plan relation unfiltered when no plan selection is supplied', () => {
		expect(paymentWhere(ORGANIZATION_ID, new ListPaymentsQueryDto())).toEqual({
			organizationId: ORGANIZATION_ID,
		});
	});
});
