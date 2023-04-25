import { buildHash, isNeitherNullNorUndefined } from '../utilities';
import { Uri } from 'vscode';
import { Message, MessageBus, MessageKind } from './messageBus';
import { Job, JobHash, JobKind } from '../jobs/types';
import { LeftRightHashSetManager } from '../leftRightHashes/leftRightHashSetManager';
import { buildUriHash } from '../uris/buildUriHash';
import { FileService } from './fileService';

type Codemod = Readonly<{
	setName: string;
	name: string;
}>;

type CodemodHash = string & { __CodemodHash: '__CodemodHash' };

const buildCodemodHash = ({ setName, name }: Codemod) =>
	buildHash([setName, name].join(',')) as CodemodHash;

export class JobManager {
	readonly #messageBus: MessageBus;

	#jobMap: Map<JobHash, Job>;
	#appliedJobsHashes: Set<JobHash>;

	#uriHashJobHashSetManager: LeftRightHashSetManager<string, JobHash>;

	public constructor(
		jobs: ReadonlyArray<Job>,
		appliedJobsHashes: ReadonlyArray<JobHash>,
		messageBus: MessageBus,
		private readonly __fileService: FileService,
	) {
		this.#jobMap = new Map(jobs.map((job) => [job.hash, job]));
		this.#appliedJobsHashes = new Set(appliedJobsHashes);

		this.#uriHashJobHashSetManager = new LeftRightHashSetManager(
			new Set(
				jobs.flatMap((job) => {
					const hashes: string[] = [];

					if (job.oldUri) {
						hashes.push(`${buildUriHash(job.oldUri)}${job.hash}`);
					}

					if (job.newUri) {
						hashes.push(`${buildUriHash(job.newUri)}${job.hash}`);
					}

					return hashes;
				}),
			),
		);

		this.#messageBus = messageBus;

		this.#messageBus.subscribe(MessageKind.upsertJobs, (message) =>
			this.#onUpsertJobsMessage(message),
		);
		this.#messageBus.subscribe(MessageKind.acceptJobs, (message) =>
			this.#onAcceptJobsMessage(message),
		);
		this.#messageBus.subscribe(MessageKind.rejectJobs, (message) =>
			this.#onRejectJobsMessage(message),
		);
		this.#messageBus.subscribe(MessageKind.clearState, () =>
			this.#onClearStateMessage(),
		);
	}

	public getJobs(): IterableIterator<Job> {
		return this.#jobMap.values();
	}

	public getJob(jobHash: JobHash): Job | null {
		return this.#jobMap.get(jobHash) ?? null;
	}

	public getFileJobs(uriHash: string): ReadonlySet<Job> {
		const jobs = new Set<Job>();

		const jobHashes =
			this.#uriHashJobHashSetManager.getRightHashesByLeftHash(uriHash);

		for (const jobHash of jobHashes) {
			const job = this.#jobMap.get(jobHash);

			if (job) {
				jobs.add(job);
			}
		}

		return jobs;
	}

	#onUpsertJobsMessage(message: Message & { kind: MessageKind.upsertJobs }) {
		message.inactiveJobHashes.forEach((jobHash) => {
			this.#uriHashJobHashSetManager.deleteRightHash(jobHash);
			this.#jobMap.delete(jobHash);
		});

		for (const job of message.jobs) {
			this.#jobMap.set(job.hash, job);

			if (job.oldUri) {
				const uriHash = buildUriHash(job.oldUri);

				this.#uriHashJobHashSetManager.upsert(uriHash, job.hash);
			}

			if (job.newUri) {
				const uriHash = buildUriHash(job.newUri);

				this.#uriHashJobHashSetManager.upsert(uriHash, job.hash);
			}
		}

		this.#messageBus.publish({
			kind: MessageKind.updateElements,
		});
	}

	*#getUriHashesWithJobHashes(jobHashes: ReadonlySet<JobHash>) {
		const manager = this.#uriHashJobHashSetManager.buildByRightHashes(
			new Set(jobHashes),
		);

		const uriHashes = manager.getLeftHashes();

		for (const uriHash of uriHashes) {
			const jobHashes = manager.getRightHashesByLeftHash(uriHash);

			yield {
				uriHash,
				jobHashes,
			};
		}
	}

	async #onAcceptJobsMessage(
		message: Message & { kind: MessageKind.acceptJobs },
	) {
		this.acceptJobs(message.jobHashes);
	}

	public async acceptJobs(jobHashes: ReadonlySet<JobHash>): Promise<void> {
		// HERE

		const { codemodHashJobHashSetManager, codemods } =
			this.#buildCodemodObjects(jobHashes);

		const messages: Message[] = [];

		messages.push({ kind: MessageKind.updateElements });

		{
			const codemodHashes = codemodHashJobHashSetManager.getLeftHashes();

			for (const codemodHash of codemodHashes) {
				const deletedJobHashes =
					codemodHashJobHashSetManager.getRightHashesByLeftHash(
						codemodHash,
					);
				const codemod = codemods.get(codemodHash);

				if (!deletedJobHashes || !codemod) {
					continue;
				}

				messages.push({
					kind: MessageKind.jobsAccepted,
					deletedJobHashes,
					codemodSetName: codemod.setName,
					codemodName: codemod.name,
				});
			}
		}

		{
			const createJobOutputs: [Uri, Uri][] = [];
			const updateJobOutputs: [Uri, Uri][] = [];
			const deleteJobOutputs: Uri[] = [];
			const moveJobOutputs: [Uri, Uri, Uri][] = [];

			for (const { jobHashes: hashes } of this.#getUriHashesWithJobHashes(
				jobHashes,
			)) {
				const job = Array.from(hashes)
					.map((jobHash) => this.#jobMap.get(jobHash))
					.filter(isNeitherNullNorUndefined)?.[0];

				if (!job) {
					continue;
				}

				if (
					job.kind === JobKind.createFile &&
					job.newUri &&
					job.newContentUri
				) {
					createJobOutputs.push([
						job.newUri,
						job.newContentUri,
					]);
				}

				if (job.kind === JobKind.deleteFile && job.oldUri) {
					deleteJobOutputs.push(job.oldUri);
				}

				if (
					(job.kind === JobKind.moveAndRewriteFile ||
						job.kind === JobKind.moveFile) &&
					job.oldUri &&
					job.newUri &&
					job.newContentUri
				) {
					moveJobOutputs.push([
						job.oldUri,
						job.newUri,
						job.newContentUri,
					]);
				}

				if (
					job.kind === JobKind.rewriteFile &&
					job.oldUri &&
					job.newContentUri
				) {
					updateJobOutputs.push([job.oldUri, job.newContentUri]);
				}

				if (
					job.kind === JobKind.copyFile &&
					job.newUri &&
					job.newContentUri
				) {
					createJobOutputs.push([
						job.newUri,
						job.newContentUri,
					]);
				}
			}

			for (const createJobOutput of createJobOutputs) {
				const [newUri, newContentUri] = createJobOutput;
				await this.__fileService.createFile({
					newUri,
					newContentUri,
				});
			}

			for (const updateJobOutput of updateJobOutputs) {
				const [uri, contentUri] = updateJobOutput;
				await this.__fileService.updateFile({
					uri,
					contentUri,
				});
			}

			for (const moveJobOutput of moveJobOutputs) {
				const [oldUri, newUri, newContentUri] = moveJobOutput;
				await this.__fileService.moveFile({
					oldUri,
					newUri,
					newContentUri,
				});
			}

			await this.__fileService.deleteFiles({
				uris: deleteJobOutputs.slice(),
			});
		}

		for (const jobHash of jobHashes) {
			this.#uriHashJobHashSetManager.deleteRightHash(jobHash);
			this.#jobMap.delete(jobHash);
		}

		for (const message of messages) {
			this.#messageBus.publish(message);
		}
	}

	public applyJob(jobHash: JobHash): void {
		this.#appliedJobsHashes.add(jobHash);
	}

	public unapplyJob(jobHash: JobHash): void {
		this.#appliedJobsHashes.delete(jobHash);
	}

	public isJobApplied(jobHash: JobHash): boolean {
		return this.#appliedJobsHashes.has(jobHash);
	}

	public getAppliedJobsHashes() {
		return this.#appliedJobsHashes;
	}

	#onRejectJobsMessage(message: Message & { kind: MessageKind.rejectJobs }) {
		const { codemodHashJobHashSetManager, codemods } =
			this.#buildCodemodObjects(message.jobHashes);

		const messages: Message[] = [];

		{
			const codemodHashes = codemodHashJobHashSetManager.getLeftHashes();

			for (const codemodHash of codemodHashes) {
				const deletedJobHashes =
					codemodHashJobHashSetManager.getRightHashesByLeftHash(
						codemodHash,
					);
				const codemod = codemods.get(codemodHash);

				if (!deletedJobHashes || !codemod) {
					continue;
				}

				messages.push({
					kind: MessageKind.jobsRejected,
					deletedJobHashes,
					codemodSetName: codemod.setName,
					codemodName: codemod.name,
				});
			}
		}

		for (const jobHash of message.jobHashes) {
			const job = this.#jobMap.get(jobHash);

			if (
				job &&
				(job.kind === JobKind.rewriteFile ||
					job.kind === JobKind.moveAndRewriteFile ||
					job.kind === JobKind.createFile ||
					job.kind === JobKind.moveFile ||
					job.kind === JobKind.copyFile) &&
				job.newContentUri
			) {
				messages.push({
					kind: MessageKind.deleteFiles,
					uris: [job.newContentUri],
				});
			}

			this.#uriHashJobHashSetManager.deleteRightHash(jobHash);
			this.#jobMap.delete(jobHash);
		}

		messages.push({ kind: MessageKind.updateElements });

		for (const message of messages) {
			this.#messageBus.publish(message);
		}
	}

	#buildCodemodObjects(jobHashes: ReadonlySet<JobHash>) {
		const codemodHashJobHashSetManager = new LeftRightHashSetManager<
			CodemodHash,
			JobHash
		>(new Set());
		const codemods = new Map<CodemodHash, Codemod>();

		for (const jobHash of jobHashes) {
			const job = this.#jobMap.get(jobHash);

			if (!job) {
				continue;
			}

			const codemod: Codemod = {
				setName: job.codemodSetName,
				name: job.codemodName,
			};

			const codemodHash = buildCodemodHash(codemod);

			codemodHashJobHashSetManager.upsert(codemodHash, jobHash);
			codemods.set(codemodHash, codemod);
		}

		return {
			codemodHashJobHashSetManager,
			codemods,
		};
	}

	#onClearStateMessage() {
		const uris: Uri[] = [];

		for (const job of this.#jobMap.values()) {
			if (
				(job.kind === JobKind.rewriteFile ||
					job.kind === JobKind.moveAndRewriteFile) &&
				job.newContentUri
			) {
				uris.push(job.newContentUri);
			}
		}

		this.#jobMap.clear();
		this.#uriHashJobHashSetManager.clear();
		this.#appliedJobsHashes.clear();

		this.#messageBus.publish({
			kind: MessageKind.deleteFiles,
			uris,
		});
	}
}
