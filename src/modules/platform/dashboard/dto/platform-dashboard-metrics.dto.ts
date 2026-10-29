import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class PlatformDashboardMetricsQueryDto {
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
		example: '2026-10-29',
		description: 'Last inclusive Africa/Kigali day. Cannot be after today.',
	})
	@IsOptional()
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/u)
	toDate?: string;

	@ApiPropertyOptional({
		enum: ['all-time'],
		description: 'Returns lifetime totals. Cannot be combined with date filters.',
	})
	@IsOptional()
	@IsString()
	@IsIn(['all-time'])
	scope?: 'all-time';
}

export class PlatformDashboardMetricsPeriodDto {
	@ApiProperty({ enum: ['CURRENT_MONTH', 'CUSTOM', 'ALL_TIME'] })
	mode!: 'CURRENT_MONTH' | 'CUSTOM' | 'ALL_TIME';

	@ApiProperty({ type: String, format: 'date', nullable: true })
	fromDate!: string | null;

	@ApiProperty({ type: String, format: 'date', nullable: true })
	toDate!: string | null;

	@ApiProperty({ type: String, format: 'date', nullable: true })
	comparisonFromDate!: string | null;

	@ApiProperty({ type: String, format: 'date', nullable: true })
	comparisonToDate!: string | null;

	@ApiProperty({ enum: ['Africa/Kigali'] })
	timeZone!: 'Africa/Kigali';
}

export class PlatformDashboardMetricChangeDto {
	@ApiProperty({ enum: ['UP', 'DOWN', 'UNCHANGED', 'NEW', 'NOT_APPLICABLE'] })
	direction!: 'UP' | 'DOWN' | 'UNCHANGED' | 'NEW' | 'NOT_APPLICABLE';

	@ApiProperty({
		type: Number,
		nullable: true,
		description: 'Signed percentage rounded to one decimal, or null without a baseline.',
	})
	percent!: number | null;
}

export class PlatformDashboardCountMetricDto {
	@ApiProperty({ type: 'integer', minimum: 0 })
	current!: number;

	@ApiProperty({ type: 'integer', minimum: 0, nullable: true })
	previous!: number | null;

	@ApiProperty({ type: PlatformDashboardMetricChangeDto })
	change!: PlatformDashboardMetricChangeDto;
}

export class PlatformDashboardMetricsDto {
	@ApiProperty({ type: PlatformDashboardCountMetricDto })
	organizations!: PlatformDashboardCountMetricDto;
}

/** Extensible, aggregate-only contract. New domains belong under metrics after separate review. */
export class PlatformDashboardMetricsResponseDto {
	@ApiProperty({ format: 'date-time' })
	generatedAt!: string;

	@ApiProperty({ type: PlatformDashboardMetricsPeriodDto })
	period!: PlatformDashboardMetricsPeriodDto;

	@ApiProperty({ type: PlatformDashboardMetricsDto })
	metrics!: PlatformDashboardMetricsDto;
}
