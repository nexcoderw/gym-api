import { OrganizationPaymentMethod } from '@nexcoderw/gym-db';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ListMembersQueryDto } from '../../src/modules/owner/members/dto/list-members.dto.js';
import { MemberPeriodUnit } from '../../src/modules/owner/members/member-period.js';
import { CreatePaymentDto } from '../../src/modules/owner/payments/dto/create-payment.dto.js';
import { ListPaymentsQueryDto } from '../../src/modules/owner/payments/dto/list-payments-query.dto.js';
import { RegisterPaymentDto } from '../../src/modules/owner/payments/dto/register-payment.dto.js';

const MEMBER_ID = '11ab9b64-19b3-ee0d-19c8-e2c69b0722da';
const PAYMENT_ID = 'ef9635e3-131b-08bb-b357-c2dbb0a4565e';
const PLAN_ID = '11111111-1111-4111-8111-111111111111';

describe('owner persisted UUID validation', () => {
	it('accepts PostgreSQL UUID values in member and payment list filters', () => {
		const members = plainToInstance(ListMembersQueryDto, { cursor: MEMBER_ID });
		const payments = plainToInstance(ListPaymentsQueryDto, {
			cursor: PAYMENT_ID,
			memberId: MEMBER_ID,
		});

		expect(validateSync(members)).toHaveLength(0);
		expect(validateSync(payments)).toHaveLength(0);
	});

	it('accepts persisted member and subscription IDs for payment commands', () => {
		const payment = plainToInstance(CreatePaymentDto, {
			memberId: MEMBER_ID,
			subscriptionId: PAYMENT_ID,
			amount: 10_000,
			method: OrganizationPaymentMethod.CASH,
			occurredAt: '2026-10-18T08:00:00.000Z',
		});
		const registration = plainToInstance(RegisterPaymentDto, {
			memberId: MEMBER_ID,
			subscription: {
				membershipPlanId: PLAN_ID,
				startDate: '2026-10-18',
				periodUnit: MemberPeriodUnit.MONTHS,
				periodCount: 1,
			},
			method: OrganizationPaymentMethod.CASH,
			occurredAt: '2026-10-18T08:00:00.000Z',
		});

		expect(validateSync(payment)).toHaveLength(0);
		expect(validateSync(registration)).toHaveLength(0);
	});

	it('still rejects malformed identifiers', () => {
		const query = plainToInstance(ListPaymentsQueryDto, { memberId: 'not-a-uuid' });
		expect(validateSync(query)).not.toHaveLength(0);
	});
});
