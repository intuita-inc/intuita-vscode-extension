import { API, Repository, Branch, Change, Remote } from '../../types/git';
import { MessageBus, MessageKind } from '../messageBus';

const branchNameFromStr = (str: string): string => {
	let branchName = str
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/--+/g, '-')
		.replace(/^-+|-+$/g, '');

	if (branchName.length > 63) {
		branchName = branchName.substr(0, 63);
	}

	if (!/^[a-z0-9]/.test(branchName)) {
		branchName = 'x-' + branchName;
	}

	return branchName;
};

type PersistedState = {
	remoteUrl: string | null;
} | null;

export class RepositoryService {
	__repo: Repository | null = null;
	__remoteUrl: string | null = null;

	constructor(
		private readonly __gitAPI: API | null,
		private readonly __messageBus: MessageBus,
		persistedState: PersistedState,
	) {
		this.__repo = this.__gitAPI?.repositories[0] ?? null;

		if (this.__gitAPI?.state === 'initialized') {
			this.__init(persistedState);
		}

		this.__gitAPI?.onDidChangeState((state) => {
			if (state !== 'initialized') {
				return;
			}
			this.__init(persistedState);
		});
	}

	private __init(persistedState: PersistedState): void {
		this.__repo = this.__gitAPI?.repositories[0] ?? null;
		this.__remoteUrl =
			persistedState?.remoteUrl ??
			this.__repo?.state.remotes[0]?.pushUrl ??
			null;
		this.__messageBus.publish({
			kind: MessageKind.repositoryPathChanged,
			repositoryPath: this.__remoteUrl,
		});
	}

	public async getAllBranches() {
		return this.__repo?.getBranches({ remote: true });
	}

	public getCurrentBranch(): Branch | null {
		return this.__repo?.state.HEAD ?? null;
	}

	public getWorkingTreeChanges(): ReadonlyArray<Change> {
		return this.__repo?.state.workingTreeChanges ?? [];
	}

	public hasChangesToCommit(): boolean {
		if (this.__repo === null) {
			return false;
		}

		return (
			this.__repo.state.indexChanges.length !== 0 ||
			this.__repo.state.workingTreeChanges.length !== 0
		);
	}

	public getBranchName(jobHash: string, jobTitle: string): string {
		return branchNameFromStr(`${jobTitle}-${jobHash}`);
	}

	public async getBranch(branchName: string): Promise<Branch | null> {
		if (this.__repo === null) {
			return null;
		}

		try {
			return await this.__repo.getBranch(branchName);
		} catch (e) {
			return null;
		}
	}

	public async isBranchExists(branchName: string): Promise<boolean> {
		const branch = await this.getBranch(branchName);
		return branch !== null;
	}

	public async submitChanges(
		branchName: string,
		remoteName: string,
	): Promise<void> {
		if (this.__repo === null) {
			return;
		}

		const branchAlreadyExists = await this.isBranchExists(branchName);

		if (branchAlreadyExists) {
			await this.__repo.checkout(branchName);
		} else {
			await this.__repo.createBranch(branchName, true);
		}

		await this.__repo.add([]);
		await this.__repo.commit('Test commit', { all: true });
		await this.__repo.push(remoteName, branchName, true);
	}

	public setRemoteUrl(remoteUrl: string) {
		this.__remoteUrl = remoteUrl;
	}

	public getRemoteUrl(): string | null {
		return this.__remoteUrl;
	}

	public getRemotes(): ReadonlyArray<Remote> {
		return this.__repo?.state.remotes ?? [];
	}
}
