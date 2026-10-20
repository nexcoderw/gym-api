import { BadRequestException } from '@nestjs/common';

import { listDateRange } from '../../src/modules/owner/list-date-range.js';

describe('Kigali list date range', () => {
	it('uses an inclusive local end date with an exclusive UTC boundary', () => {
		expect(listDateRange('2026-01-01', '2026-01-31')).toEqual({
			gte: new Date('2025-12-31T22:00:00.000Z'),
			lt: new Date('2026-01-31T22:00:00.000Z'),
		});
	});

	it('supports open-ended filters', () => {
		expect(listDateRange('2026-10-19')).toEqual({
			gte: new Date('2026-10-18T22:00:00.000Z'),
		});
		expect(listDateRange(undefined, '2026-10-19')).toEqual({
			lt: new Date('2026-10-19T22:00:00.000Z'),
		});
	});

	it('rejects reversed and nonexistent calendar dates', () => {
		expect(() => listDateRange('2026-02-01', '2026-01-31')).toThrow(BadRequestException);
		expect(() => listDateRange('2026-02-30')).toThrow(BadRequestException);
	});
});
