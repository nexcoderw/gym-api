import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ORGANIZATION_ID = 'f6e417be-b93e-40ef-b028-d9d03666e69f';
const DEFAULT_SEED = 'kd-gym-members-2026-11-12-v1';
const DATE_RANGE = Object.freeze({
	from: '2025-10-18',
	to: '2026-11-12',
	timezone: 'Africa/Kigali',
});
const CATEGORIES = Object.freeze([
	'RWANDAN_STYLE',
	'RWANDAN_CHRISTIAN_COMBINATION',
	'RWANDAN_MUSLIM_COMBINATION',
]);
const CATEGORY_TARGETS = Object.freeze({
	RWANDAN_STYLE: 330,
	RWANDAN_CHRISTIAN_COMBINATION: 390,
	RWANDAN_MUSLIM_COMBINATION: 103,
});
const MONTH_TARGETS = Object.freeze([
	{
		month: '2025-10',
		start: '2025-10-18',
		end: '2025-10-31',
		male: 16,
		female: 2,
		reservedUnknown: 0,
	},
	{
		month: '2025-11',
		start: '2025-11-01',
		end: '2025-11-30',
		male: 33,
		female: 5,
		reservedUnknown: 0,
	},
	{
		month: '2025-12',
		start: '2025-12-01',
		end: '2025-12-31',
		male: 38,
		female: 6,
		reservedUnknown: 0,
	},
	{
		month: '2026-01',
		start: '2026-01-01',
		end: '2026-01-31',
		male: 50,
		female: 8,
		reservedUnknown: 0,
	},
	{
		month: '2026-02',
		start: '2026-02-01',
		end: '2026-02-28',
		male: 44,
		female: 7,
		reservedUnknown: 0,
	},
	{
		month: '2026-03',
		start: '2026-03-01',
		end: '2026-03-31',
		male: 54,
		female: 9,
		reservedUnknown: 0,
	},
	{
		month: '2026-04',
		start: '2026-04-01',
		end: '2026-04-30',
		male: 46,
		female: 8,
		reservedUnknown: 0,
	},
	{
		month: '2026-05',
		start: '2026-05-01',
		end: '2026-05-31',
		male: 60,
		female: 10,
		reservedUnknown: 0,
	},
	{
		month: '2026-06',
		start: '2026-06-01',
		end: '2026-06-30',
		male: 52,
		female: 9,
		reservedUnknown: 0,
	},
	{
		month: '2026-07',
		start: '2026-07-01',
		end: '2026-07-31',
		male: 68,
		female: 11,
		reservedUnknown: 0,
	},
	{
		month: '2026-08',
		start: '2026-08-01',
		end: '2026-08-31',
		male: 63,
		female: 10,
		reservedUnknown: 0,
	},
	{
		month: '2026-09',
		start: '2026-09-01',
		end: '2026-09-30',
		male: 74,
		female: 12,
		reservedUnknown: 0,
	},
	{
		month: '2026-10',
		start: '2026-10-01',
		end: '2026-10-31',
		male: 79,
		female: 12,
		reservedUnknown: 1,
	},
	{
		month: '2026-11',
		start: '2026-11-01',
		end: '2026-11-12',
		male: 32,
		female: 5,
		reservedUnknown: 0,
	},
]);
const CSV_FIELDS = Object.freeze([
	'id',
	'organizationId',
	'name',
	'normalizedName',
	'phoneNumber',
	'gender',
	'email',
	'joinedOn',
	'synthetic',
	'generationCategory',
	'generationBatch',
]);
const DEFAULT_OUTPUT_DIR = fileURLToPath(new URL('./output/', import.meta.url));

const RWANDAN_GIVEN_NAMES = Object.freeze({
	MALE: [
		'Mugisha', 'Niyonzima', 'Habimana', 'Nshimiyimana', 'Niyigena', 'Nsengimana', 'Rukundo',
		'Ndayisenga', 'Bizimana', 'Hategekimana', 'Munyaneza', 'Nkurunziza', 'Niyonsenga',
		'Uwiringiyimana', 'Manirakiza', 'Niyomugabo', 'Mutabazi', 'Munyakazi', 'Niyonsaba',
		'Nsabimana', 'Rugamba', 'Mbarushimana', 'Ntakirutimana', 'Mugwaneza', 'Mugabo',
		'Niyitegeka', 'Rugwiro', 'Iradukunda', 'Niyibizi', 'Nkurikiyumukiza', 'Ndikumana',
		'Mujawamariya', 'Nizeyimana', 'Habyarimana', 'Rurangirwa', 'Munyampundu', 'Niyomwungeri',
	],
	FEMALE: [
		'Uwase', 'Ineza', 'Mutoni', 'Umutoni', 'Uwimana', 'Mukamana', 'Nyirahabimana', 'Ingabire',
		'Uwera', 'Mutesi', 'Munyaneza', 'Niyonsaba', 'Niyomwungeri', 'Iradukunda', 'Mugwaneza',
		'Nyiransabimana', 'Mukeshimana', 'Niyigena', 'Nshimiyimana', 'Niyonzima', 'Umutesi',
		'Nyiraminani', 'Mukarwego', 'Uwizeye', 'Nyiransengimana', 'Munezero', 'Niyonsenga',
		'Munyakazi', 'Mukamurenzi', 'Niyomugabo', 'Uwamahoro', 'Mukarukundo', 'Munyampundu',
		'Niyitegeka', 'Umuhoza', 'Ntakirutimana', 'Nkurunziza', 'Mukandayisenga', 'Nizeyimana',
	],
});
const RWANDAN_FAMILY_NAMES = Object.freeze([
	'Niyonzima', 'Habimana', 'Nshimiyimana', 'Niyigena', 'Nsengimana', 'Rukundo', 'Ndayisenga',
	'Bizimana', 'Hategekimana', 'Munyaneza', 'Nkurunziza', 'Niyonsenga', 'Manirakiza', 'Mutabazi',
	'Niyomugabo', 'Munyakazi', 'Niyonsaba', 'Nsabimana', 'Rugamba', 'Mbarushimana',
	'Ntakirutimana', 'Mugwaneza', 'Mugabo', 'Niyitegeka', 'Rugwiro', 'Iradukunda', 'Niyibizi',
	'Ndikumana', 'Nizeyimana', 'Rurangirwa', 'Munyampundu', 'Niyomwungeri', 'Uwamahoro',
	'Mukarukundo', 'Munezero', 'Uwizeye', 'Mukeshimana', 'Umuhoza', 'Mutesi', 'Ingabire', 'Uwera',
	'Ineza', 'Mugisha', 'Mukamana', 'Mukarwego', 'Nyiransabimana', 'Uwimana', 'Umutoni', 'Uwase',
	'Mukamurenzi', 'Nkurikiyumukiza', 'Mujawamariya', 'Habyarimana',
]);
const CHRISTIAN_GIVEN_NAMES = Object.freeze({
	MALE: [
		'Jean', 'Claude', 'David', 'Patrick', 'Emmanuel', 'Eric', 'Samuel', 'Joseph', 'Daniel',
		'Peter', 'Paul', 'Simon', 'Jean Pierre', 'Jean Claude', 'Jean Bosco', 'Alexis', 'Theoneste',
		'Fabrice', 'Christian', 'Benjamin', 'Gabriel', 'Raphael', 'Vincent', 'Alphonse', 'Didier',
		'Olivier', 'Oscar', 'Felicien', 'Jules', 'Marc',
	],
	FEMALE: [
		'Marie', 'Claire', 'Alice', 'Grace', 'Chantal', 'Jeanne', 'Odette', 'Esther', 'Agnes',
		'Beatrice', 'Diane', 'Angelique', 'Emmanuelle', 'Carine', 'Solange', 'Immaculee', 'Anne',
		'Aline', 'Jacqueline', 'Claudine', 'Claudette', 'Christine', 'Josiane', 'Esperance',
		'Monique', 'Sarah', 'Madeleine', 'Therese', 'Noella', 'Francine',
	],
});
const MUSLIM_GIVEN_NAMES = Object.freeze({
	MALE: [
		'Ibrahim', 'Yusuf', 'Ismail', 'Omar', 'Ali', 'Hassan', 'Musa', 'Abdallah', 'Karim', 'Said',
		'Hamza', 'Khalid', 'Mustafa', 'Salim', 'Bilal', 'Idris', 'Abubakar', 'Farid', 'Mahmud', 'Nabil',
	],
	FEMALE: [
		'Amina', 'Fatima', 'Khadija', 'Aisha', 'Zainab', 'Mariam', 'Hawa', 'Halima', 'Safiya', 'Salma',
		'Nadia', 'Samira', 'Jamila', 'Rukiya', 'Hafsa', 'Nuru', 'Asma', 'Safa', 'Layla', 'Zahra',
	],
});

/**
 * Generates local synthetic historical member files without connecting to external systems.
 */
export function generateDataset({ seed = DEFAULT_SEED } = {}) {
	assertSeed(seed);
	const random = createRandom(seed);
	const memberSkeletons = [];
	for (const target of MONTH_TARGETS) {
		const genders = shuffle(
			[
				...Array(target.male).fill('MALE'),
				...Array(target.female).fill('FEMALE'),
			],
			random,
		);
		const dates = weightedDates(target.start, target.end, genders.length, random);
		for (let index = 0; index < genders.length; index += 1) {
			memberSkeletons.push({ gender: genders[index], joinedOn: dates[index] });
		}
	}

	const categories = shuffle(
		CATEGORIES.flatMap((category) => Array(CATEGORY_TARGETS[category]).fill(category)),
		random,
	);
	const prefixes = shuffle(
		[...Array(412).fill('+25078'), ...Array(411).fill('+25072')],
		random,
	);
	const seenNames = new Set();
	const seenPhones = new Set();
	const records = memberSkeletons.map((member, index) => {
		const generationCategory = categories[index];
		const name = uniqueName(member.gender, generationCategory, random, seenNames);
		const phoneNumber = uniquePhone(prefixes[index], random, seenPhones);
		const normalizedName = normalizeName(name);
		return {
			id: deterministicUuid(`${seed}:${index + 1}`),
			organizationId: ORGANIZATION_ID,
			name,
			normalizedName,
			phoneNumber,
			gender: member.gender,
			email: null,
			joinedOn: member.joinedOn,
			synthetic: true,
			generationCategory,
			generationBatch: seed,
		};
	});

	return records.sort((left, right) => {
		if (left.joinedOn !== right.joinedOn) return left.joinedOn < right.joinedOn ? -1 : 1;
		if (left.id === right.id) return 0;
		return left.id < right.id ? -1 : 1;
	});
}

/** Validates member rows against the fixed KD GYM fixture plan and member API field rules. */
export function validateDataset(records, { seed = DEFAULT_SEED } = {}) {
	assertSeed(seed);
	const errors = [];
	const ids = records.map((record) => record.id);
	const names = records.map((record) => record.normalizedName);
	const phones = records.map((record) => record.phoneNumber);
	const monthBreakdown = Object.fromEntries(
		MONTH_TARGETS.map((target) => [target.month, { male: 0, female: 0 }]),
	);
	const categoryCounts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
	const prefixCounts = { '+25078': 0, '+25072': 0 };

	if (records.length !== 823) errors.push(`Expected 823 records; received ${records.length}.`);
	for (const record of records) {
		const month = record.joinedOn.slice(0, 7);
		if (monthBreakdown[month] === undefined) {
			errors.push(`Unexpected join month ${month}.`);
		} else if (record.gender === 'MALE') {
			monthBreakdown[month].male += 1;
		} else if (record.gender === 'FEMALE') {
			monthBreakdown[month].female += 1;
		} else {
			errors.push(`Unsupported gender for ${record.id}.`);
		}

		if (record.organizationId !== ORGANIZATION_ID) {
			errors.push(`Wrong organization for ${record.id}.`);
		}
		if (record.synthetic !== true) errors.push(`Record ${record.id} is not marked synthetic.`);
		if (typeof record.name !== 'string' || record.name.length < 1 || record.name.length > 160) {
			errors.push(`Invalid name length for ${record.id}.`);
		}
		if (
			record.normalizedName !== normalizeName(record.name) ||
			record.normalizedName.length > 160
		) {
			errors.push(`Name normalization mismatch for ${record.id}.`);
		}
		const components = record.name.trim().split(/[\s\u0085]+/u);
		if (components.length < 2 || components.length > 4) {
			errors.push(`Name must have 2 to 4 components for ${record.id}.`);
		}
		if (
			!/^[+][1-9]\d{7,14}$/u.test(record.phoneNumber) ||
			!/^\+250(?:78|72)\d{7}$/u.test(record.phoneNumber)
		) {
			errors.push(`Invalid synthetic phone number for ${record.id}.`);
		} else {
			prefixCounts[record.phoneNumber.slice(0, 6)] += 1;
		}
		if (!isValidUuid(record.id)) errors.push(`Invalid UUID for ${record.id}.`);
		if (
			!isValidDate(record.joinedOn) ||
			record.joinedOn < DATE_RANGE.from ||
			record.joinedOn > DATE_RANGE.to
		) {
			errors.push(`Date outside the configured range for ${record.id}.`);
		}
		if (record.email !== null) errors.push(`Expected null email for ${record.id}.`);
		if (!CATEGORIES.includes(record.generationCategory)) {
			errors.push(`Invalid naming category for ${record.id}.`);
		} else {
			categoryCounts[record.generationCategory] += 1;
		}
		if (record.generationBatch !== seed) {
			errors.push(`Invalid batch metadata for ${record.id}.`);
		}
	}

	for (const target of MONTH_TARGETS) {
		const actual = monthBreakdown[target.month];
		if (actual.male !== target.male || actual.female !== target.female) {
			errors.push(`Monthly gender target mismatch for ${target.month}.`);
		}
		const plannedTotal = actual.male + actual.female + target.reservedUnknown;
		if (plannedTotal === 0 || (actual.male / plannedTotal) * 100 < 85) {
			errors.push(`Male registration share is below 85% for ${target.month}.`);
		}
	}
	for (const category of CATEGORIES) {
		if (categoryCounts[category] !== CATEGORY_TARGETS[category]) {
			errors.push(`Naming category target mismatch for ${category}.`);
		}
	}
	if (countDuplicates(ids) !== 0) errors.push('Duplicate IDs found.');
	if (countDuplicates(names) !== 0) errors.push('Duplicate normalized names found.');
	if (countDuplicates(phones) !== 0) errors.push('Duplicate phone numbers found.');
	if (records.filter((record) => record.gender === 'MALE').length !== 709) {
		errors.push('Expected exactly 709 male members.');
	}
	if (records.filter((record) => record.gender === 'FEMALE').length !== 114) {
		errors.push('Expected exactly 114 female members.');
	}
	if (prefixCounts['+25078'] === 0 || prefixCounts['+25072'] === 0) {
		errors.push('Both configured phone prefixes must be represented.');
	}

	return {
		valid: errors.length === 0,
		errors,
		recordCount: records.length,
		monthlyGenderBreakdown: makeMonthlyBreakdown(monthBreakdown),
		namingCategoryCounts: categoryCounts,
		phonePrefixDistribution: prefixCounts,
		duplicateCounts: {
			id: countDuplicates(ids),
			normalizedName: countDuplicates(names),
			phoneNumber: countDuplicates(phones),
		},
	};
}

/** Writes CSV, JSONL, manifest, and validation report to the requested local directory. */
export function writeDataset(outputDirectory, { seed = DEFAULT_SEED } = {}) {
	assertSeed(seed);
	const allowedOutputDirectory = resolve(DEFAULT_OUTPUT_DIR);
	const requestedOutputDirectory = resolve(outputDirectory);
	if (!isWithinDirectory(allowedOutputDirectory, requestedOutputDirectory)) {
		throw new Error(
			'Output directory must be inside the gitignored synthetic-data output directory.',
		);
	}
	const records = generateDataset({ seed });
	const validation = validateDataset(records, { seed });
	if (!validation.valid) {
		throw new Error(`Generated data failed validation: ${validation.errors.join(' ')}`);
	}

	const csv = `${toCsv(records)}\n`;
	const jsonl = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
	const report = {
		valid: true,
		errors: validation.errors,
		recordCount: validation.recordCount,
		dateRange: DATE_RANGE,
		monthlyGenderBreakdown: validation.monthlyGenderBreakdown,
		namingCategoryCounts: validation.namingCategoryCounts,
		phonePrefixDistribution: validation.phonePrefixDistribution,
		checks: {
			exactRecordCount: validation.recordCount === 823,
			exactGenderTotals:
				records.filter((record) => record.gender === 'MALE').length === 709 &&
				records.filter((record) => record.gender === 'FEMALE').length === 114,
			exactMonthlyGenderTargets: validation.monthlyGenderBreakdown.every((month) =>
				month.male === month.targetMale && month.female === month.targetFemale,
			),
			minimumMonthlyMaleShare: validation.monthlyGenderBreakdown.every(
				(month) => month.malePercentageIncludingReservedUnknown >= 85,
			),
			uniqueIds: validation.duplicateCounts.id === 0,
			uniqueNormalizedNames: validation.duplicateCounts.normalizedName === 0,
			uniquePhoneNumbers: validation.duplicateCounts.phoneNumber === 0,
			validUuidFormat: records.every((record) => isValidUuid(record.id)),
			validGenderValues: records.every(
				(record) => record.gender === 'MALE' || record.gender === 'FEMALE',
			),
			validPhoneFormat: records.every((record) =>
				/^\+250(?:78|72)\d{7}$/u.test(record.phoneNumber),
			),
			validDates: records.every(
				(record) => record.joinedOn >= DATE_RANGE.from && record.joinedOn <= DATE_RANGE.to,
			),
			validNameComponentCounts: records.every((record) => {
				const count = record.name.trim().split(/[\s\u0085]+/u).length;
				return count >= 2 && count <= 4;
			}),
			schemaCompatibleNameLengths: records.every(
				(record) => record.name.length <= 160 && record.normalizedName.length <= 160,
			),
			exactNamingCategoryCounts:
				validation.namingCategoryCounts.RWANDAN_STYLE === 330 &&
				validation.namingCategoryCounts.RWANDAN_CHRISTIAN_COMBINATION === 390 &&
				validation.namingCategoryCounts.RWANDAN_MUSLIM_COMBINATION === 103,
			mixedPhonePrefixes:
				validation.phonePrefixDistribution['+25078'] > 0 &&
				validation.phonePrefixDistribution['+25072'] > 0,
			allRecordsBelongToOrganization: records.every(
				(record) => record.organizationId === ORGANIZATION_ID,
			),
			noUnexpectedNullFields: records.every((record) =>
				CSV_FIELDS.filter((field) => field !== 'email').every(
					(field) => record[field] !== null && record[field] !== undefined,
				),
			),
			csvAndJsonlRecordCountsMatch: csv.trimEnd().split('\n').length - 1 === records.length,
		},
		duplicateCounts: validation.duplicateCounts,
	};
	if (Object.values(report.checks).some((passed) => passed !== true)) {
		throw new Error('Generated data failed an output validation check.');
	}

	const manifest = {
		organizationId: ORGANIZATION_ID,
		generationSeed: seed,
		recordCount: records.length,
		dateRange: DATE_RANGE,
		monthlyGenderBreakdown: validation.monthlyGenderBreakdown,
		namingCategoryCounts: validation.namingCategoryCounts,
		phonePrefixDistribution: validation.phonePrefixDistribution,
		duplicateCounts: validation.duplicateCounts,
		sha256: {
			'members.csv': sha256(csv),
			'members.jsonl': sha256(jsonl),
		},
		syntheticDataWarning: [
			'Synthetic fixtures only. Names and naming-category metadata describe generated patterns',
			'and make no claims about real people or religious identity. Phone numbers are fabricated,',
			'not verified or contacted, and must not be used for messaging.',
		].join(' '),
	};
	const outputs = new Map([
		['members.csv', csv],
		['members.jsonl', jsonl],
		['manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
		['validation-report.json', `${JSON.stringify(report, null, 2)}\n`],
	]);

	try {
		if (lstatSync(allowedOutputDirectory).isSymbolicLink()) {
			throw new Error('Refusing to write through a symlinked output directory.');
		}
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
	mkdirSync(requestedOutputDirectory, { recursive: true });
	const allowedOutputRoot = realpathSync(allowedOutputDirectory);
	const outputRoot = realpathSync(requestedOutputDirectory);
	if (!isWithinDirectory(allowedOutputRoot, outputRoot)) {
		throw new Error('Resolved output directory escaped the gitignored output directory.');
	}
	for (const [filename, contents] of outputs) {
		const destination = join(outputRoot, filename);
		try {
			if (!lstatSync(destination).isFile()) {
				throw new Error(`Refusing to replace non-file output: ${filename}`);
			}
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		writeFileSync(destination, contents, { encoding: 'utf8', mode: 0o600 });
	}
	return { outputDirectory: outputRoot, recordCount: records.length, manifest, report };
}

function parseArguments(arguments_) {
	const options = { seed: DEFAULT_SEED, outputDirectory: DEFAULT_OUTPUT_DIR, help: false };
	for (let index = 0; index < arguments_.length; index += 1) {
		const flag = arguments_[index];
		if (flag === '--help') {
			options.help = true;
			continue;
		}
		if (flag !== '--seed' && flag !== '--output-dir') throw new Error(`Unknown option: ${flag}`);
		const value = arguments_[index + 1];
		if (value === undefined || value.startsWith('--')) {
			throw new Error(`A value is required for ${flag}.`);
		}
		if (flag === '--seed') {
			assertSeed(value);
			options.seed = value;
		} else {
			if (value.trim().length === 0) throw new Error('Output directory must not be empty.');
			options.outputDirectory = isAbsolute(value) ? value : resolve(process.cwd(), value);
		}
		index += 1;
	}
	return options;
}

function assertSeed(seed) {
	if (typeof seed !== 'string' || seed.trim().length === 0 || seed.length > 128) {
		throw new Error('Generation seed must contain 1 to 128 non-whitespace characters.');
	}
}

function isWithinDirectory(parent, candidate) {
	const childPath = relative(parent, candidate);
	return (
		childPath === '' ||
		(childPath !== '..' && !childPath.startsWith(`..${sep}`) && !isAbsolute(childPath))
	);
}

function createRandom(seed) {
	let state = createHash('sha256').update(seed).digest().readUInt32BE(0) || 1;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function shuffle(values, random) {
	const output = [...values];
	for (let index = output.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		[output[index], output[swapIndex]] = [output[swapIndex], output[index]];
	}
	return output;
}

function weightedDates(start, end, count, random) {
	const days = [];
	for (
		let day = new Date(`${start}T12:00:00.000Z`);
		day <= new Date(`${end}T12:00:00.000Z`);
		day.setUTCDate(day.getUTCDate() + 1)
	) {
		days.push(day.toISOString().slice(0, 10));
	}
	const weights = days.map(() => 0.35 + random() * 1.65);
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
	const counts = weights.map(() => 0);
	for (let member = 0; member < count; member += 1) {
		let sample = random() * totalWeight;
		for (let index = 0; index < weights.length; index += 1) {
			sample -= weights[index];
			if (sample < 0 || index === weights.length - 1) {
				counts[index] += 1;
				break;
			}
		}
	}
	return shuffle(days.flatMap((day, index) => Array(counts[index]).fill(day)), random);
}

function uniqueName(gender, category, random, seenNames) {
	for (let attempt = 0; attempt < 20_000; attempt += 1) {
		const components = createNameComponents(gender, category, random);
		const name = components.join(' ');
		const normalizedName = normalizeName(name);
		if (components.length >= 2 && components.length <= 4 && !seenNames.has(normalizedName)) {
			seenNames.add(normalizedName);
			return name;
		}
	}
	throw new Error(`Could not generate a unique ${category} name after 20,000 attempts.`);
}

function createNameComponents(gender, category, random) {
	const rwandanParts = () => pick(RWANDAN_FAMILY_NAMES, random);
	if (category === 'RWANDAN_STYLE') {
		const given = pick(RWANDAN_GIVEN_NAMES[gender], random);
		const family = distinctParts(1 + (random() < 0.24 ? 1 : 0), rwandanParts, random, [given]);
		return random() < 0.16 ? [...family, given] : [given, ...family];
	}
	if (category === 'RWANDAN_CHRISTIAN_COMBINATION') {
		const christian = pick(CHRISTIAN_GIVEN_NAMES[gender], random).split(' ');
		const addSecondChristian = random() < 0.24 && christian.length === 1;
		const given = addSecondChristian
			? [
					christian[0],
					pick(
						CHRISTIAN_GIVEN_NAMES[gender].filter(
							(name) => !name.includes(' ') && name !== christian[0],
						),
						random,
					),
				]
			: christian;
		const family = distinctParts(
			Math.max(1, Math.min(4 - given.length, random() < 0.32 ? 2 : 1)),
			rwandanParts,
			random,
			given,
		);
		return random() < 0.14 ? [...family, ...given] : [...given, ...family];
	}
	if (category === 'RWANDAN_MUSLIM_COMBINATION') {
		const given = [pick(MUSLIM_GIVEN_NAMES[gender], random)];
		if (random() < 0.16) {
			given.push(pick(MUSLIM_GIVEN_NAMES[gender].filter((name) => name !== given[0]), random));
		}
		const family = distinctParts(
			Math.max(1, Math.min(4 - given.length, random() < 0.4 ? 2 : 1)),
			rwandanParts,
			random,
			given,
		);
		return random() < 0.12 ? [...family, ...given] : [...given, ...family];
	}
	throw new Error(`Unsupported naming category: ${category}`);
}

function distinctParts(count, getPart, random, excluded) {
	const output = [];
	let attempts = 0;
	while (output.length < count) {
		attempts += 1;
		if (attempts > 1_000) throw new Error('Name component pool exhausted.');
		const part = getPart();
		if (!excluded.includes(part) && !output.includes(part)) output.push(part);
	}
	return output;
}

function pick(values, random) {
	return values[Math.floor(random() * values.length)];
}

function uniquePhone(prefix, random, seenPhones) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		let suffix = '';
		for (let digit = 0; digit < 7; digit += 1) suffix += Math.floor(random() * 10);
		const phoneNumber = `${prefix}${suffix}`;
		if (!seenPhones.has(phoneNumber)) {
			seenPhones.add(phoneNumber);
			return phoneNumber;
		}
	}
	throw new Error('Could not generate a unique synthetic phone number.');
}

function deterministicUuid(value) {
	const namespace = Buffer.from(ORGANIZATION_ID.replaceAll('-', ''), 'hex');
	const bytes = createHash('sha1').update(namespace).update(value).digest().subarray(0, 16);
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20),
	].join('-');
}

function normalizeName(value) {
	return value.normalize('NFKC').replace(/[\s\u0085]+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function toCsv(records) {
	const lines = [CSV_FIELDS.join(',')];
	for (const record of records) {
		lines.push(CSV_FIELDS.map((field) => csvCell(record[field])).join(','));
	}
	return lines.join('\n');
}

function csvCell(value) {
	const cell = value === null ? '' : String(value);
	return /[",\r\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

function makeMonthlyBreakdown(counts) {
	return MONTH_TARGETS.map((target) => {
		const actual = counts[target.month];
		const plannedTotal = actual.male + actual.female + target.reservedUnknown;
		return {
			month: target.month,
			male: actual.male,
			female: actual.female,
			reservedExistingUnknown: target.reservedUnknown,
			plannedTotalIncludingReserved: plannedTotal,
			malePercentageIncludingReservedUnknown: Number(((actual.male / plannedTotal) * 100).toFixed(2)),
			targetMale: target.male,
			targetFemale: target.female,
		};
	});
}

function countDuplicates(values) {
	return values.length - new Set(values).size;
}

function isValidUuid(value) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isValidDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function helpText() {
	return [
		'Generate 823 deterministic synthetic KD GYM member fixtures offline.',
		'',
		'Usage: node scripts/synthetic-data/generate-kd-gym-members.mjs [options]',
		`Default seed: ${DEFAULT_SEED}`,
		`Default output: ${DEFAULT_OUTPUT_DIR}`,
		'Options:',
		'  --seed VALUE       Use a non-empty deterministic seed of at most 128 characters.',
		'  --output-dir PATH  Select a subdirectory within the default ignored output directory.',
		'Custom output paths must be inside the gitignored default output directory.',
		'Only the four generated fixture files are written. No database or network is used.',
	].join('\n');
}

const isMainModule =
	process.argv[1] !== undefined &&
	pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
	try {
		const options = parseArguments(process.argv.slice(2));
		if (options.help) {
			process.stdout.write(`${helpText()}\n`);
		} else {
			const result = writeDataset(options.outputDirectory, options);
			process.stdout.write(
				`Generated ${result.recordCount} synthetic member fixtures in ${result.outputDirectory}.\n`,
			);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Synthetic data generation failed.';
		process.stderr.write(`${message}\n`);
		process.exitCode = 1;
	}
}
