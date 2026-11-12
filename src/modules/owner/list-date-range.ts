import { BadRequestException } from '@nestjs/common';

/** Interpret list filters as inclusive calendar days in Africa/Kigali (UTC+02:00). */
export function listDateRange(fromDate?: string, toDate?: string): { gte?: Date; lt?: Date } {
	validateOrder(fromDate, toDate);
	const from = fromDate === undefined ? undefined : kigaliMidnight(fromDate);
	const to = toDate === undefined ? undefined : kigaliMidnight(toDate, 1);
	return {
		...(from === undefined ? {} : { gte: from }),
		...(to === undefined ? {} : { lt: to }),
	};
}

/** Build inclusive UTC-midnight bounds for a PostgreSQL DATE column. */
export function listDateOnlyRange(
	fromDate?: string,
	toDate?: string,
): {
	gte?: Date;
	lt?: Date;
} {
	validateOrder(fromDate, toDate);
	const from = fromDate === undefined ? undefined : calendarDate(fromDate);
	const to = toDate === undefined ? undefined : calendarDate(toDate);
	if (to !== undefined) to.setUTCDate(to.getUTCDate() + 1);
	return {
		...(from === undefined ? {} : { gte: from }),
		...(to === undefined ? {} : { lt: to }),
	};
}

function kigaliMidnight(value: string, addDays = 0): Date {
	const date = calendarDate(value);
	date.setUTCDate(date.getUTCDate() + addDays);
	date.setUTCHours(date.getUTCHours() - 2);
	return date;
}

function calendarDate(value: string): Date {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (
		!/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
		Number.isNaN(date.getTime()) ||
		date.toISOString().slice(0, 10) !== value
	) {
		throw new BadRequestException('Use a valid calendar date in YYYY-MM-DD format.');
	}
	return date;
}

function validateOrder(fromDate?: string, toDate?: string): void {
	if (fromDate !== undefined && toDate !== undefined && fromDate > toDate) {
		throw new BadRequestException('From date must not be after to date.');
	}
}
