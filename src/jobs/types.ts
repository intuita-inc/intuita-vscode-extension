import { Uri } from 'vscode';

export type JobHash = string & { __type: 'JobHash' };

export const enum JobKind {
	rewriteFile = 1,
	createFile = 2,
	deleteFile = 3,
	moveFile = 4,
	moveAndRewriteFile = 5,
	copyFile = 6,
}

export type Job = Readonly<{
	hash: JobHash;
	kind: JobKind;
	oldUri: Uri | null;
	newUri: Uri | null;
	oldContentUri: Uri | null;
	newContentUri: Uri | null;
	codemodSetName: string;
	codemodName: string;
	createdAt: number;
	executionId: string;
}>;

export type PersistedJob = Readonly<{
	hash: JobHash;
	kind: JobKind;
	oldUri: string | null;
	newUri: string | null;
	oldContentUri: string | null;
	newContentUri: string | null;
	codemodSetName: string;
	codemodName: string;
	createdAt: number;
	executionId: string;
}>;

export const mapJobToPersistedJob = (job: Job): PersistedJob => {
	return {
		...job,
		oldUri: job.oldUri?.toString() ?? null,
		newUri: job.newUri?.toString() ?? null,
		oldContentUri: job.oldContentUri?.toString() ?? null,
		newContentUri: job.newContentUri?.toString() ?? null,
	};
};

export const mapPersistedJobToJob = (persistedJob: PersistedJob): Job => {
	return {
		...persistedJob,
		oldUri: persistedJob.oldUri ? Uri.parse(persistedJob.oldUri) : null,
		newUri: persistedJob.newUri ? Uri.parse(persistedJob.newUri) : null,
		oldContentUri: persistedJob.oldContentUri
			? Uri.parse(persistedJob.oldContentUri)
			: null,
		newContentUri: persistedJob.oldContentUri
			? Uri.parse(persistedJob.oldContentUri)
			: null,
	};
};
