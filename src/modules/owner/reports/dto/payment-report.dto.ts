import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class PaymentReportQueryDto {
	@ApiProperty({
		format: 'date',
		example: '2026-01-01',
		description: 'First payment day in Africa/Kigali.',
	})
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/u)
	fromDate!: string;

	@ApiProperty({
		format: 'date',
		example: '2026-01-31',
		description: 'Last payment day in Africa/Kigali, inclusive.',
	})
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/u)
	toDate!: string;
}

/** Whole-RWF amounts are decimal strings so large report totals never lose integer precision. */
export class PaymentReportSummaryDto {
	@ApiProperty({ format: 'date' })
	fromDate!: string;
	@ApiProperty({ format: 'date' })
	toDate!: string;
	@ApiProperty({ enum: ['RWF'] })
	currency!: 'RWF';
	@ApiProperty({ description: 'All payment records in the period, including non-settled records.' })
	paymentCount!: number;
	@ApiProperty({ description: 'Confirmed, partially refunded, and refunded payment records.' })
	settledPaymentCount!: number;
	@ApiProperty({
		type: String,
		pattern: '^[0-9]+$',
		description: 'Original settled payment value.',
	})
	grossRwf!: string;
	@ApiProperty({
		type: String,
		pattern: '^[0-9]+$',
		description: 'Confirmed refunds linked to payments in the selected period, as of generation.',
	})
	refundedRwf!: string;
	@ApiProperty({ type: String, pattern: '^[0-9]+$', description: 'Gross less confirmed refunds.' })
	netRwf!: string;
	@ApiProperty({ format: 'date-time' })
	generatedAt!: string;
}
