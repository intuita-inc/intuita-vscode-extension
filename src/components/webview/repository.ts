import { APIState } from '../../../git';
import { API, Repository } from '../../../git';

const branchNameFromStr = (str: string): string => {
	let branchName = str.toLowerCase();

	branchName = branchName.replace(/\s+/g, '-');

	branchName = branchName.replace(/[^a-z0-9-]/g, '-');

	branchName = branchName.replace(/--+/g, '-');

	branchName = branchName.replace(/^-+|-+$/g, '');

	if (branchName.length > 63) {
		branchName = branchName.substr(0, 63);
	}

	if (!/^[a-z0-9]/.test(branchName)) {
		branchName = 'x-' + branchName;
	}

	return branchName;
};

export class UninitializedError extends Error {}

export class RepositoryService {
	__repo: Repository | null = null;

	constructor(private readonly __gitAPI: API) {
		this.__gitAPI.onDidChangeState(this.onDidChangeState);
	}

	private onDidChangeState = (state: APIState) => {
		if (state === 'initialized') {
			this.__repo = this.__gitAPI.repositories[0] ?? null;
		}
	};

	private ensureRepoInitialized(
		this: RepositoryService,
	): asserts this is { __repo: Repository } {
		if (!this.__repo) {
			throw new UninitializedError();
		}
	}

	public getAllBranches = async () => {
		// @TODO instead of this checks in each methods, just init repo before creating service...
		// repo service should not exist without repo...
		this.ensureRepoInitialized();

		return this.__repo.getBranches({ remote: true });
	};

	public getCurrentBranch = async () => {
		this.ensureRepoInitialized();

		return this.__repo.state.HEAD;
	};

	public getWorkingTreeChanges = async () => {
		this.ensureRepoInitialized();

		return this.__repo.state.workingTreeChanges;
	};

	public hasWorkingTreeChanges = async () => {
		const changes = await this.getWorkingTreeChanges();

		return changes.length !== 0;
	};

	public getBranchName = (jobHash: string, jobTitle: string) => {
		return branchNameFromStr(`${jobTitle}-${jobHash}`);
	};

	public getBaseBranchName = () => {
		return 'main';
	};

	public submitChanges = async (branchName: string) => {
		this.ensureRepoInitialized();

		await this.__repo.createBranch(branchName, true);
		await this.__repo.add([]);
		await this.__repo.commit('Test commit', { all: true });
		await this.__repo.push('origin', branchName, true);
	};
}
