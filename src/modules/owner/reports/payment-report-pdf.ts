import PDFDocument from 'pdfkit';
import { OrganizationPaymentStatus, type OrganizationPaymentMethod } from '@nexcoderw/gym-db';

import type { PaymentReportTotals } from './payment-report-policy.js';

export interface PaymentReportPdfRow {
	readonly receiptNumber: string;
	readonly memberName: string;
	readonly occurredAt: Date;
	readonly method: OrganizationPaymentMethod;
	readonly status: OrganizationPaymentStatus;
	readonly amountRwf: bigint;
	readonly refundedRwf: bigint;
}

export interface PaymentReportPdfInput {
	readonly gymName: string;
	readonly fromDate: string;
	readonly toDate: string;
	readonly generatedAt: Date;
	readonly totals: PaymentReportTotals;
	readonly rows: readonly PaymentReportPdfRow[];
}

const LEFT = 36;
const TABLE_WIDTH = 770;
const TABLE_HEADER_HEIGHT = 26;
const COLUMNS = [
	{ label: 'Date (Kigali)', width: 88 },
	{ label: 'Receipt', width: 130 },
	{ label: 'Member', width: 153 },
	{ label: 'Method', width: 78 },
	{ label: 'Status', width: 105 },
	{ label: 'Amount', width: 74 },
	{ label: 'Refunded', width: 74 },
	{ label: 'Net', width: 68 },
] as const;

/** The PDF contains every selected payment; the database batches are not visible as report pages. */
export function renderPaymentReportPdf(input: PaymentReportPdfInput): Promise<Buffer> {
	const document = new PDFDocument({
		size: 'A4',
		layout: 'landscape',
		margin: LEFT,
		info: {
			Title: 'Gym payment report',
			Author: 'NEXCODE Gym Manager',
			Subject: `${input.fromDate} to ${input.toDate}`,
		},
	});
	const chunks: Buffer[] = [];

	return new Promise<Buffer>((resolve, reject) => {
		document.on('data', (chunk: Buffer) => chunks.push(chunk));
		document.once('end', () => resolve(Buffer.concat(chunks)));
		document.once('error', (error: Error) => reject(error));

		try {
			let page = 1;
			let y = drawFirstPage(document, input);
			if (input.rows.length === 0) {
				document.font('Helvetica').fontSize(10).fillColor('#52627A');
				document.text('No payments occurred in this date range.', LEFT + 8, y + 24);
			}

			for (const [index, row] of input.rows.entries()) {
				const cells = rowCells(row);
				const rowHeight = Math.max(
					29,
					...cells.map((value, column) =>
						document.font('Helvetica').fontSize(8).heightOfString(value, {
							width: (COLUMNS[column]?.width ?? 68) - 10,
						}) + 12,
					),
				);
				if (y + rowHeight > document.page.height - 55) {
					drawFooter(document, page);
					document.addPage();
					page += 1;
					y = drawContinuationPage(document, input, page);
				}
				drawRow(document, cells, y, rowHeight, index);
				y += rowHeight;
			}

			drawFooter(document, page);
			document.end();
		} catch (error: unknown) {
			reject(error);
		}
	});
}

function drawFirstPage(document: PDFKit.PDFDocument, input: PaymentReportPdfInput): number {
	document.rect(0, 0, document.page.width, 76).fill('#102C60');
	document.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF');
	document.text('PAYMENT REPORT', LEFT, 24);
	document.font('Helvetica').fontSize(10).fillColor('#D5E7FF');
	document.text(clean(input.gymName), 345, 29, { width: 460, align: 'right' });

	document.font('Helvetica').fontSize(9).fillColor('#52627A');
	document.text(`Period: ${input.fromDate} to ${input.toDate} (Africa/Kigali)`, LEFT, 93);
	document.text(`Generated: ${kigaliDateTime(input.generatedAt)}`, 512, 93, {
		width: 294,
		align: 'right',
	});

	const figures = [
		['Payments', input.totals.paymentCount.toString()],
		['Settled', input.totals.settledPaymentCount.toString()],
		['Gross RWF', money(BigInt(input.totals.grossRwf))],
		['Refunded RWF', money(BigInt(input.totals.refundedRwf))],
		['Net RWF', money(BigInt(input.totals.netRwf))],
	] as const;
	for (const [index, [label, value]] of figures.entries()) {
		const x = LEFT + index * (TABLE_WIDTH / figures.length);
		document.roundedRect(x, 115, 146, 55, 8).fill('#F0F5FB');
		document.font('Helvetica').fontSize(8).fillColor('#52627A');
		document.text(label, x + 10, 125, { width: 126 });
		document.font('Helvetica-Bold').fontSize(13).fillColor('#102C60');
		document.text(value, x + 10, 141, { width: 126, height: 19, ellipsis: true });
	}

	document.font('Helvetica-Bold').fontSize(11).fillColor('#16233B');
	document.text('Payment ledger', LEFT, 190);
	return drawTableHeader(document, 211);
}

function drawContinuationPage(
	document: PDFKit.PDFDocument,
	input: PaymentReportPdfInput,
	page: number,
): number {
	document.rect(0, 0, document.page.width, 64).fill('#102C60');
	document.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF');
	document.text('PAYMENT REPORT', LEFT, 24);
	document.font('Helvetica').fontSize(9).fillColor('#D5E7FF');
	document.text(`${input.fromDate} to ${input.toDate}  |  Page ${page}`, 510, 27, {
		width: 296,
		align: 'right',
	});
	return drawTableHeader(document, 82);
}

function drawTableHeader(document: PDFKit.PDFDocument, y: number): number {
	document.rect(LEFT, y, TABLE_WIDTH, TABLE_HEADER_HEIGHT).fill('#E5ECF6');
	let x = LEFT;
	for (const column of COLUMNS) {
		document.font('Helvetica-Bold').fontSize(8).fillColor('#102C60');
		document.text(column.label, x + 5, y + 9, { width: column.width - 10 });
		x += column.width;
	}
	return y + TABLE_HEADER_HEIGHT;
}

function drawRow(
	document: PDFKit.PDFDocument,
	cells: readonly string[],
	y: number,
	height: number,
	index: number,
): void {
	if (index % 2 === 0) document.rect(LEFT, y, TABLE_WIDTH, height).fill('#F7F9FC');
	let x = LEFT;
	for (const [columnIndex, column] of COLUMNS.entries()) {
		document.font('Helvetica').fontSize(8).fillColor('#23314A');
		document.text(cells[columnIndex] ?? '', x + 5, y + 7, {
			width: column.width - 10,
			height: height - 12,
		});
		x += column.width;
	}
	document.strokeColor('#E5ECF6').lineWidth(0.5);
	document.moveTo(LEFT, y + height).lineTo(LEFT + TABLE_WIDTH, y + height).stroke();
}

function drawFooter(document: PDFKit.PDFDocument, page: number): void {
	const y = document.page.height - 35;
	document.strokeColor('#D3DFEC').lineWidth(0.7);
	document.moveTo(LEFT, y - 8).lineTo(LEFT + TABLE_WIDTH, y - 8).stroke();
	document.font('Helvetica').fontSize(8).fillColor('#52627A');
	document.text('Confidential - gym owner financial report', LEFT, y);
	document.text(`Page ${page}`, LEFT + 675, y, { width: 95, align: 'right' });
}

function rowCells(row: PaymentReportPdfRow): string[] {
	const settled =
		row.status === OrganizationPaymentStatus.CONFIRMED ||
		row.status === OrganizationPaymentStatus.PARTIALLY_REFUNDED ||
		row.status === OrganizationPaymentStatus.REFUNDED;
	return [
		kigaliDateTime(row.occurredAt),
		clean(row.receiptNumber),
		clean(row.memberName),
		label(row.method),
		label(row.status),
		money(row.amountRwf),
		money(row.refundedRwf),
		money(settled ? row.amountRwf - row.refundedRwf : 0n),
	];
}

function kigaliDateTime(value: Date): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Africa/Kigali',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).format(value);
}

function money(value: bigint): string {
	return value.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

function label(value: string): string {
	return value.replaceAll('_', ' ').toLowerCase().replace(/^\w/u, (letter) => letter.toUpperCase());
}

function clean(value: string): string {
	return value.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim();
}
