import { BadRequestException } from '@nestjs/common';

/** Interpret list filters as inclusive calendar days in Africa/Kigali (UTC+02:00). */
export function listDateRange(fromDate?: string, toDate?: string): { gte?: Date; lt?: Date } {
	if (fromDate !== undefined && toDate !== undefined && fromDate > toDate) {
		throw new BadRequestException('From date must not be after to date.');
	}
	const from = fromDate === undefined ? undefined : kigaliMidnight(fromDate);
	const to = toDate === undefined ? undefined : kigaliMidnight(toDate, 1);
	return {
		...(from === undefined ? {} : { gte: from }),
		...(to === undefined ? {} : { lt: to }),
	};
}

function kigaliMidnight(value: string, addDays = 0): Date {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
		throw new BadRequestException('Use a valid calendar date in YYYY-MM-DD format.');
	}
	date.setUTCDate(date.getUTCDate() + addDays);
	date.setUTCHours(date.getUTCHours() - 2);
	return date;
}
