export function assertProductionTarget(target: unknown): void;
export function buildMemberInsertData(
	members: readonly Readonly<Record<string, unknown>>[],
	insertedAt: Date,
): readonly Readonly<Record<string, unknown>>[];
export function runSerializableImportTransaction(
	prisma: { $transaction: (operation: (transaction: unknown) => Promise<unknown>, options: unknown) => Promise<unknown> },
	operation: (transaction: unknown) => Promise<unknown>,
): Promise<unknown>;
export function writeImportManifestOnce(
	path: string,
	value: unknown,
	directory?: string,
): void;
export function applyHistoricalMembers(
	prisma: unknown,
	target: unknown,
	members: readonly Readonly<Record<string, unknown>>[],
	datasetReport: Readonly<Record<string, unknown>>,
	approval: Readonly<Record<string, unknown>>,
	backup: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>>;
