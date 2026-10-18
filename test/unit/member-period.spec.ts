import { MemberPeriodUnit, memberPeriod } from '../../src/modules/owner/members/member-period.js';
import { memberName, memberPhone } from '../../src/modules/owner/members/member-normalization.js';

describe('member registration calendar and normalization', () => {
	it.each([
		{ start: '2026-11-01', unit: MemberPeriodUnit.MONTHS, count: 1, expected: '2026-11-30' },
		{ start: '2026-11-01', unit: MemberPeriodUnit.MONTHS, count: 3, expected: '2027-01-31' },
		{ start: '2026-01-31', unit: MemberPeriodUnit.MONTHS, count: 1, expected: '2026-02-27' },
		{ start: '2024-02-01', unit: MemberPeriodUnit.MONTHS, count: 1, expected: '2024-02-29' },
		{ start: '2026-12-31', unit: MemberPeriodUnit.DAYS, count: 1, expected: '2026-12-31' },
		{ start: '2026-12-31', unit: MemberPeriodUnit.WEEKS, count: 1, expected: '2027-01-06' },
		{ start: '2026-01-01', unit: MemberPeriodUnit.YEARS, count: 1, expected: '2026-12-31' },
	])('calculates inclusive dates: $start $unit $count', ({ start, unit, count, expected }) => {
		const result = memberPeriod(start, unit, count);
		expect(result.startDate.toISOString().slice(0, 10)).toBe(start);
		expect(result.endDate.toISOString().slice(0, 10)).toBe(expected);
	});

	it.each(['2026-02-30', '2026-13-01', '2026-1-01', '2026-01-01T00:00:00Z'])(
		'rejects impossible and non-date-only starts: %s',
		(start) => {
			expect(() => memberPeriod(start, MemberPeriodUnit.MONTHS, 1)).toThrow();
		},
	);

	it.each([0, -1, 1.5, 121])('rejects invalid month counts: %s', (count) => {
		expect(() => memberPeriod('2026-11-01', MemberPeriodUnit.MONTHS, count)).toThrow();
	});

	it('normalizes equivalent names and phone representations for uniqueness', () => {
		expect(memberName('  Ｅｘａｍｐｌｅ   Member ')).toEqual({
			name: 'Example Member',
			normalizedName: 'example member',
		});
		expect(memberPhone('0700 000 001')).toBe('+250700000001');
		expect(memberPhone('+250 (700) 000-001')).toBe('+250700000001');
	});

	it('rejects empty names and malformed phones', () => {
		expect(() => memberName('  ')).toThrow();
		for (const phone of ['700000001', 'letters', '+000000000', '+250700000001ext123']) {
			expect(() => memberPhone(phone)).toThrow();
		}
	});
});
