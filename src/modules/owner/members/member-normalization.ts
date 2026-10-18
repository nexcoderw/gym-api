import { BadRequestException } from '@nestjs/common';

export function memberName(value: string): { name: string; normalizedName: string } {
	const name = value
		.normalize('NFKC')
		.replace(/[\s\u0085]+/gu, ' ')
		.trim();
	const normalizedName = name.toLocaleLowerCase('en-US');
	if (
		name.length === 0 ||
		name.length > 160 ||
		normalizedName.length > 160 ||
		name.includes('\u0000')
	) {
		throw new BadRequestException({
			code: 'MEMBER_NAME_INVALID',
			message: 'Enter a valid member name.',
		});
	}
	return { name, normalizedName };
}

export function memberPhone(value: string): string {
	let phone = value.replace(/[\s()-]/gu, '');
	if (/^07\d{8}$/u.test(phone)) phone = `+250${phone.slice(1)}`;
	if (!/^\+[1-9]\d{7,14}$/u.test(phone)) {
		throw new BadRequestException({
			code: 'MEMBER_PHONE_INVALID',
			message: 'Use an international phone number or a Rwandan mobile number beginning with 07.',
		});
	}
	return phone;
}
