import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationPaymentMethod } from '@nexcoderw/gym-db';
import { IsOptional, IsString, Matches } from 'class-validator';

export class OwnerDashboardAnalyticsQueryDto {
	@ApiPropertyOptional({
		format: 'date',
		example: '2026-10-01',
		description: 'First inclusive Africa/Kigali day. Supply both dates or neither.',
	})
	@IsOptional()
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/u)
	fromDate?: string;

	@ApiPropertyOptional({
		format: 'date',
		example: '2026-10-22',
		description: 'Last inclusive Africa/Kigali day. Cannot be after today.',
	})
	@IsOptional()
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/u)
	toDate?: string;
}

export class DashboardPeriodDto {
	@ApiProperty({ format: 'date' })
	fromDate!: string;

	@ApiProperty({ format: 'date' })
	toDate!: string;

	@ApiProperty({ format: 'date' })
	comparisonFromDate!: string;

	@ApiProperty({ format: 'date' })
	comparisonToDate!: string;

	@ApiProperty({ enum: ['Africa/Kigali'] })
	timeZone!: 'Africa/Kigali';

	@ApiProperty({ enum: ['DAY', 'SEVEN_DAY', 'MONTH'] })
	revenueBucket!: 'DAY' | 'SEVEN_DAY' | 'MONTH';
}

/** A null percentage means the baseline is zero or the change is not representable. */
export class DashboardChangeDto {
	@ApiProperty({ enum: ['UP', 'DOWN', 'UNCHANGED', 'NEW'] })
	direction!: 'UP' | 'DOWN' | 'UNCHANGED' | 'NEW';

	@ApiProperty({
		type: Number,
		nullable: true,
		description: 'Signed percentage, rounded to one decimal.',
	})
	percent!: number | null;
}

export class DashboardMoneyMetricDto {
	@ApiProperty({ type: String, pattern: '^[0-9]+$' })
	currentRwf!: string;

	@ApiProperty({ type: String, pattern: '^[0-9]+$' })
	previousRwf!: string;

	@ApiProperty({ type: DashboardChangeDto })
	change!: DashboardChangeDto;
}

export class DashboardCountMetricDto {
	@ApiProperty({ minimum: 0 })
	current!: number;

	@ApiProperty({ minimum: 0 })
	previous!: number;

	@ApiProperty({ type: DashboardChangeDto })
	change!: DashboardChangeDto;
}

export class DashboardMetricsDto {
	@ApiProperty({ type: DashboardMoneyMetricDto })
	netCollected!: DashboardMoneyMetricDto;

	@ApiProperty({ type: DashboardCountMetricDto })
	settledPayments!: DashboardCountMetricDto;

	@ApiProperty({ type: DashboardCountMetricDto })
	newMembers!: DashboardCountMetricDto;

	@ApiProperty({ type: DashboardCountMetricDto })
	activeSubscribers!: DashboardCountMetricDto;
}

export class DashboardRevenuePointDto {
	@ApiProperty({ format: 'date' })
	fromDate!: string;

	@ApiProperty({ format: 'date' })
	toDate!: string;

	@ApiProperty({ type: String, pattern: '^[0-9]+$' })
	grossRwf!: string;

	@ApiProperty({ type: String, pattern: '^[0-9]+$' })
	refundedRwf!: string;

	@ApiProperty({ type: String, pattern: '^[0-9]+$' })
	netRwf!: string;
}

export class DashboardPlanTotalDto {
	@ApiProperty({ type: String, nullable: true, format: 'uuid' })
	planId!: string | null;

	@ApiProperty({ example: 'Gold Plan' })
	planName!: string;

	@ApiProperty({ type: String, pattern: '^[0-9]+$' })
	grossRwf!: string;
}

export class DashboardMethodTotalDto {
	@ApiProperty({ enum: OrganizationPaymentMethod })
	method!: OrganizationPaymentMethod;

	@ApiProperty({ minimum: 0 })
	settledPaymentCount!: number;

	@ApiProperty({ type: String, pattern: '^[0-9]+$' })
	grossRwf!: string;
}

export class OwnerDashboardAnalyticsResponseDto {
	@ApiProperty({ type: DashboardPeriodDto })
	period!: DashboardPeriodDto;

	@ApiProperty({ enum: ['RWF'] })
	currency!: 'RWF';

	@ApiProperty({ type: DashboardMetricsDto })
	metrics!: DashboardMetricsDto;

	@ApiProperty({ type: [DashboardRevenuePointDto] })
	revenueSeries!: DashboardRevenuePointDto[];

	@ApiProperty({ type: [DashboardPlanTotalDto] })
	planTotals!: DashboardPlanTotalDto[];

	@ApiProperty({ type: [DashboardMethodTotalDto] })
	methodTotals!: DashboardMethodTotalDto[];

	@ApiProperty({ format: 'date-time' })
	generatedAt!: string;
}
