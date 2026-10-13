import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { argon2id, verify } from 'argon2';

import type { EnvironmentVariables } from '../../config/environment.types.js';

const ARGON2_PARAMETERS = /\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/u;
const MINIMUM_MEMORY_COST = 65_536;
const MAXIMUM_MEMORY_COST = 262_144;
const MINIMUM_TIME_COST = 3;
const MAXIMUM_TIME_COST = 6;
const MAXIMUM_PARALLELISM = 4;

@Injectable()
export class PlatformPasswordService {
	readonly dummyHash: string;

	constructor(config: ConfigService<EnvironmentVariables, true>) {
		this.dummyHash = config.get('PLATFORM_AUTH_DUMMY_PASSWORD_HASH', { infer: true });
		if (!this.hasApprovedParameters(this.dummyHash)) {
			throw new Error('PLATFORM_AUTH_DUMMY_PASSWORD_HASH must use approved Argon2id parameters.');
		}
	}

	async verify(passwordHash: string, password: string): Promise<boolean> {
		if (!this.hasApprovedParameters(passwordHash)) {
			return false;
		}
		try {
			return await verify(passwordHash, password, { type: argon2id });
		} catch {
			return false;
		}
	}

	private hasApprovedParameters(hash: string): boolean {
		const match = ARGON2_PARAMETERS.exec(hash);
		if (match === null) {
			return false;
		}
		const memory = Number(match[1]);
		const iterations = Number(match[2]);
		const parallelism = Number(match[3]);
		return (
			memory >= MINIMUM_MEMORY_COST &&
			memory <= MAXIMUM_MEMORY_COST &&
			iterations >= MINIMUM_TIME_COST &&
			iterations <= MAXIMUM_TIME_COST &&
			parallelism >= 1 &&
			parallelism <= MAXIMUM_PARALLELISM
		);
	}
}
