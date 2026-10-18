import { BadRequestException } from '@nestjs/common';

export enum MemberPeriodUnit {
	DAYS = 'DAYS',
	WEEKS = 'WEEKS',
	MONTHS = 'MONTHS',
	YEARS = 'YEARS',
}

/** Calendar dates use UTC arithmetic; the stored end is the day before the next anniversary. */
export function memberPeriod(
	start: string,
	unit: MemberPeriodUnit,
	count: number,
): { startDate: Date; endDate: Date } {
	if (!/^20\d{2}-\d{2}-\d{2}$/u.test(start)) throw invalidPeriod();
	const startDate = new Date(`${start}T00:00:00.000Z`);
	if (!Number.isFinite(startDate.getTime()) || startDate.toISOString().slice(0, 10) !== start) {
		throw invalidPeriod();
	}
	const limits: Record<string, number> = {
		[MemberPeriodUnit.DAYS]: 3650,
		[MemberPeriodUnit.WEEKS]: 520,
		[MemberPeriodUnit.MONTHS]: 120,
		[MemberPeriodUnit.YEARS]: 10,
	};
	const maximum = limits[unit];
	if (maximum === undefined || !Number.isInteger(count) || count < 1 || count > maximum) {
		throw invalidPeriod();
	}
	const boundary = new Date(startDate);
	if (unit === MemberPeriodUnit.DAYS || unit === MemberPeriodUnit.WEEKS) {
		boundary.setUTCDate(boundary.getUTCDate() + count * (unit === MemberPeriodUnit.WEEKS ? 7 : 1));
	} else {
		const day = boundary.getUTCDate();
		boundary.setUTCDate(1);
		boundary.setUTCMonth(boundary.getUTCMonth() + count * (unit === MemberPeriodUnit.YEARS ? 12 : 1));
		const lastDay = new Date(Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth() + 1, 0));
		boundary.setUTCDate(Math.min(day, lastDay.getUTCDate()));
	}
	boundary.setUTCDate(boundary.getUTCDate() - 1);
	return { startDate, endDate: boundary };
}

function invalidPeriod(): BadRequestException {
	return new BadRequestException({
		code: 'MEMBER_PERIOD_INVALID',
		message: 'Supply a real start date and a positive period of no more than ten years.',
	});
}
