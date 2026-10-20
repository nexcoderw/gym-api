import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { TenantTransactionService } from '@nexcoderw/gym-db';

import {
	MemberOrder,
	MemberStatusFilter,
} from '../../src/modules/owner/members/dto/list-members.dto.js';
import { OwnerMembersService } from '../../src/modules/owner/members/owner-members.service.js';

const CONTEXT = {
	organizationId: '11111111-1111-4111-8111-111111111111',
	actorUserId: '22222222-2222-4222-8222-222222222222',
};
const MEMBER = {
	id: '33333333-3333-4333-8333-333333333333',
	name: 'Example Member',
	phoneNumber: '+250700000001',
	email: null,
	archivedAt: null,
	createdAt: new Date('2026-10-18T08:00:00.000Z'),
	updatedAt: new Date('2026-10-18T08:00:00.000Z'),
};
const QUERY = { limit: 20, status: MemberStatusFilter.ACTIVE, order: MemberOrder.NEWEST };

describe('owner member numbered pagination', () => {
	let module: TestingModule | undefined;
	let service: OwnerMembersService;
	const count = jest.fn<() => Promise<number>>();
	const findMany = jest.fn<() => Promise<(typeof MEMBER)[]>>();
	const findFirst = jest.fn<() => Promise<{ id: string } | null>>();
	const transaction = { organizationMember: { count, findMany, findFirst } };

	beforeEach(async () => {
		jest.resetAllMocks();
		count.mockResolvedValue(325);
		findMany.mockResolvedValue([MEMBER]);
		findFirst.mockResolvedValue({ id: MEMBER.id });
		module = await Test.createTestingModule({
			providers: [
				OwnerMembersService,
				{
					provide: TenantTransactionService,
					useValue: {
						run: async (
							_context: unknown,
							operation: (value: typeof transaction) => Promise<unknown>,
						): Promise<unknown> => operation(transaction),
					},
				},
			],
		}).compile();
		service = module.get(OwnerMembersService);
	});

	afterEach(async () => module?.close());

	it('jumps directly to the last page without traversing cursors', async () => {
		const response = await service.list(CONTEXT, { ...QUERY, page: 17 });

		expect(response).toMatchObject({
			page: 17,
			totalItems: 325,
			totalPages: 17,
			nextCursor: null,
			items: [{ id: MEMBER.id }],
		});
		expect(count).toHaveBeenCalledWith({
			where: { organizationId: CONTEXT.organizationId, archivedAt: null },
		});
		expect(findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { organizationId: CONTEXT.organizationId, archivedAt: null },
				skip: 320,
				take: 20,
			}),
		);
		expect(findFirst).not.toHaveBeenCalled();
	});

	it('clamps a stale page number after the filtered total shrinks', async () => {
		count.mockResolvedValue(21);
		const response = await service.list(CONTEXT, { ...QUERY, page: 99 });
		expect(response.page).toBe(2);
		expect(response.totalPages).toBe(2);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
	});

	it('counts and pages only tenant members matching the search', async () => {
		count.mockResolvedValue(1);
		const response = await service.list(CONTEXT, { ...QUERY, search: 'Example' });
		expect(response.totalItems).toBe(1);
		const where = {
			organizationId: CONTEXT.organizationId,
			archivedAt: null,
			OR: [
				{ name: { contains: 'Example', mode: 'insensitive' } },
				{ phoneNumber: { contains: 'Example', mode: 'insensitive' } },
				{ email: { contains: 'Example', mode: 'insensitive' } },
			],
		};
		expect(count).toHaveBeenCalledWith({ where });
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
	});

	it('rejects mixing page and cursor modes', async () => {
		await expect(
			service.list(CONTEXT, { ...QUERY, page: 2, cursor: MEMBER.id }),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(count).not.toHaveBeenCalled();
	});
});
