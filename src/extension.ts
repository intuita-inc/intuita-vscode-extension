import * as t from 'io-ts';
import * as vscode from 'vscode';
import { getConfiguration } from './configuration';
import { buildContainer } from './container';
import { Command, MessageBus, MessageKind } from './components/messageBus';
import { JobManager } from './components/jobManager';
import { FileService } from './components/fileService';
import { JobHash } from './jobs/types';
import { CaseManager } from './cases/caseManager';
import { CaseHash } from './cases/types';
import { DownloadService } from './components/downloadService';
import { FileSystemUtilities } from './components/fileSystemUtilities';
import { NoraCompareServiceEngine } from './components/noraCompareServiceEngine';
import { EngineService, Messages } from './components/engineService';
import { BootstrapExecutablesService } from './components/bootstrapExecutablesService';
import { StatusBarItemManager } from './components/statusBarItemManager';
import { PersistedStateService } from './persistedState/persistedStateService';
import { getPersistedState } from './persistedState/getPersistedState';
import {
	mapPersistedCaseToCase,
	mapPersistedJobToJob,
} from './persistedState/mappers';
import {
	dependencyNameToRecipeName,
	InformationMessageService,
} from './components/informationMessageService';
import {
	branchNameFromStr,
	buildTypeCodec,
	isNeitherNullNorUndefined,
} from './utilities';
import prettyReporter from 'io-ts-reporters';
import { buildExecutionId } from './telemetry/hashes';
import { TelemetryService } from './telemetry/telemetryService';
import {
	projectNameCodec,
	PROJECT_NAMES,
	RECIPE_MAP,
	recipeNameCodec,
} from './recipes/codecs';
import { IntuitaTextDocumentContentProvider } from './components/textDocumentContentProvider';
import { GlobalStateAccountStorage } from './components/user/userAccountStorage';
import { AlreadyLinkedError, UserService } from './components/user/userService';
import {
	NotFoundIntuitaAccount,
	SourceControlService,
} from './components/sourceControl';
import { SourceControlWebviewPanel } from './components/webview/SourceControlWebviewPanel';
import { isAxiosError } from 'axios';
import { RepositoryService } from './components/webview/repository';
import { ElementHash } from './elements/types';

import type { GitExtension } from './types/git';
import { FileExplorerProvider } from './components/webview/FileExplorerProvider';
import { CampaignManagerProvider } from './components/webview/CampaignManagerProvider';
import { DiffWebviewPanel } from './components/webview/DiffWebviewPanel';
import {
	createIssueParamsCodec,
	createPullRequestParamsCodec,
	applyChangesCoded,
} from './components/sourceControl/codecs';
import { buildJobElementLabel } from './elements/buildJobElement';
import { CodemodListPanelProvider } from './components/webview/CodemodListProvider';
import { CodemodService } from './packageJsonAnalyzer/codemodService';
import { CodemodHash } from './packageJsonAnalyzer/types';
import { randomBytes } from 'crypto';

const messageBus = new MessageBus();

export async function activate(context: vscode.ExtensionContext) {
	messageBus.setDisposables(context.subscriptions);

	const configurationContainer = buildContainer(getConfiguration());

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(() => {
			configurationContainer.set(getConfiguration());
		}),
	);

	const persistedState = await getPersistedState(
		vscode.workspace.fs,
		() => context.storageUri ?? null,
	);

	const fileService = new FileService(messageBus);

	const jobManager = new JobManager(
		persistedState?.jobs.map((job) => mapPersistedJobToJob(job)) ?? [],
		(persistedState?.appliedJobsHashes ?? []) as JobHash[],
		messageBus,
		fileService,
	);

	const caseManager = new CaseManager(
		persistedState?.cases.map((kase) => mapPersistedCaseToCase(kase)) ?? [],
		new Set(persistedState?.caseHashJobHashes),
		messageBus,
	);

	const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;

	const fileSystemUtilities = new FileSystemUtilities(vscode.workspace.fs);

	const downloadService = new DownloadService(
		vscode.workspace.fs,
		fileSystemUtilities,
	);

	const statusBarItem = vscode.window.createStatusBarItem(
		'intuita.statusBarItem',
		vscode.StatusBarAlignment.Right,
		100,
	);

	statusBarItem.command = 'intuita.shutdownEngines';

	context.subscriptions.push(statusBarItem);

	const statusBarItemManager = new StatusBarItemManager(statusBarItem);

	const engineService = new EngineService(
		configurationContainer,
		messageBus,
		vscode.workspace.fs,
		statusBarItemManager,
	);

	new BootstrapExecutablesService(
		downloadService,
		context.globalStorageUri,
		vscode.workspace.fs,
		messageBus,
		statusBarItemManager,
	);

	new NoraCompareServiceEngine(messageBus);

	const gitExtension =
		vscode.extensions.getExtension<GitExtension>('vscode.git');
	const activeGitExtension = gitExtension?.isActive
		? gitExtension.exports
		: await gitExtension?.activate();

	const git = activeGitExtension?.getAPI(1) ?? null;

	const repositoryService = new RepositoryService(
		git,
		persistedState?.remoteUrl ?? null,
	);

	const persistedStateService = new PersistedStateService(
		caseManager,
		vscode.workspace.fs,
		() => context.storageUri ?? null,
		jobManager,
		messageBus,
		repositoryService,
	);

	const intuitaTextDocumentContentProvider =
		new IntuitaTextDocumentContentProvider();

	const codemodService = new CodemodService(rootPath ?? null, engineService);
	const codemodListWebviewProvider = new CodemodListPanelProvider(
		context,
		messageBus,
		rootPath,
		codemodService,
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'intuita-available-codemod-tree-view',
			codemodListWebviewProvider,
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.openCaseDiff',
			async (caseHash?: ElementHash) => {
				if (!caseHash || !rootPath) {
					return;
				}
				try {
					const panelInstance = DiffWebviewPanel.getInstance(
						{
							type: 'intuitaPanel',
							title: 'Diff',
							extensionUri: context.extensionUri,
							initialData: {},
							viewColumn: vscode.ViewColumn.One,
							webviewName: 'jobDiffView',
						},
						messageBus,
						jobManager,
						caseManager,
						rootPath,
					);
					await panelInstance.render();
					const viewProps = await panelInstance.getViewDataForCase(
						caseHash,
					);

					if (!viewProps) {
						return;
					}
					const { title, data } = viewProps;
					panelInstance.setTitle(title);

					panelInstance.setView({
						viewId: 'jobDiffView',
						viewProps: {
							diffId: String(caseHash) as CaseHash,
							title,
							data,
						},
					});
				} catch (err) {
					console.error(err);
				}
			},
		),
	);

	/**
	 * User
	 */
	const globalStateAccountStorage = new GlobalStateAccountStorage(
		context.globalState,
	);

	const userService = new UserService(globalStateAccountStorage, messageBus);

	const sourceControl = new SourceControlService(
		globalStateAccountStorage,
		messageBus,
		repositoryService,
	);

	const fileExplorerProvider = new FileExplorerProvider(
		context,
		messageBus,
		jobManager,
		caseManager,
	);

	const intuitaFileExplorer = vscode.window.registerWebviewViewProvider(
		'intuitaFileExplorer',
		fileExplorerProvider,
	);

	context.subscriptions.push(intuitaFileExplorer);

	const campaignManagerProvider = new CampaignManagerProvider(
		context,
		messageBus,
		jobManager,
		caseManager,
		fileExplorerProvider,
	);

	const intuitaCampaignManager = vscode.window.registerWebviewViewProvider(
		'intuitaCampaignManager',
		campaignManagerProvider,
	);

	context.subscriptions.push(intuitaCampaignManager);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.createIssue', async () => {
			const initialData = {
				userId: globalStateAccountStorage.getUserAccount(),
			};

			// @TODO
			const title = 'Label';

			const panelInstance = SourceControlWebviewPanel.getInstance(
				{
					type: 'intuitaPanel',
					title,
					extensionUri: context.extensionUri,
					initialData,
					viewColumn: vscode.ViewColumn.One,
					webviewName: 'sourceControl',
				},
				messageBus,
			);

			await panelInstance.render();

			const remoteUrl = repositoryService.getRemoteUrl();

			if (remoteUrl === null) {
				throw new Error('Unable to detect the git remote URI');
			}

			const remotes = repositoryService.getRemotes();
			const remoteOptions = remotes
				.map(({ pushUrl }) => pushUrl)
				.filter(isNeitherNullNorUndefined);

			panelInstance.setView({
				viewId: 'createIssue',
				viewProps: {
					initialFormData: { title, body: '', remoteUrl },
					loading: false,
					error: '',
					remoteOptions,
				},
			});
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.user.unlinkIntuitaAccount',
			() => {
				userService.unlinkUserIntuitaAccount();
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.redirect', (arg0) => {
			try {
				vscode.env.openExternal(vscode.Uri.parse(arg0));
			} catch (e) {
				vscode.window.showWarningMessage('Invalid URL:' + arg0);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.applyJob',
			async (arg0: unknown) => {
				const jobHash = typeof arg0 === 'string' ? arg0 : null;

				if (jobHash === null) {
					throw new Error(
						`Could not decode the first positional arguments: it should have been a string`,
					);
				}

				jobManager.applyJob(jobHash as JobHash);

				messageBus.publish({ kind: MessageKind.updateElements });
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.unapplyJob',
			async (arg0: unknown) => {
				const jobHash = typeof arg0 === 'string' ? arg0 : null;

				if (jobHash === null) {
					throw new Error(
						`Could not decode the first positional arguments: it should have been a string`,
					);
				}

				jobManager.unapplyJob(jobHash as JobHash);

				messageBus.publish({ kind: MessageKind.updateElements });
			},
		),
	);

	// @TODO reuse this in createPR
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.sourceControl.commitChanges',
			async (arg0) => {
				try {
					const decoded = createPullRequestParamsCodec.decode(arg0);

					if (decoded._tag === 'Left') {
						throw new Error(
							prettyReporter.report(decoded).join('\n'),
						);
					}

					const { newBranchName, createNewBranch, commitMessage } =
						decoded.right;

					const remotes = repositoryService.getRemotes();
					const remote = (remotes ?? []).find(
						(remote) => remote.pushUrl === decoded.right.remoteUrl,
					);

					if (!remote || !remote.pushUrl) {
						throw new Error('Remote not found');
					}

					const currentBranch = repositoryService.getCurrentBranch();

					const currentBranchName = currentBranch?.name ?? null;

					if (currentBranchName === null) {
						throw new Error('Unable to get current branch');
					}

					await repositoryService.commitChanges(
						createNewBranch ? newBranchName : currentBranchName,
						commitMessage,
					);

					vscode.window.showInformationMessage(
						`Committed on branch ${currentBranchName}`,
					);

					messageBus.publish({
						kind: MessageKind.updateElements,
					});

					if (remote.pushUrl) {
						repositoryService.setRemoteUrl(remote.pushUrl);
						persistedStateService.saveExtensionState();
					}
				} catch (e) {
					const message =
						isAxiosError<{ message?: string }>(e) &&
						e.response?.data.message
							? e.response.data.message
							: e instanceof Error
							? e.message
							: String(e);
					vscode.window.showErrorMessage(message);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.sourceControl.createPR',
			async (arg0) => {
				try {
					const decoded = createPullRequestParamsCodec.decode(arg0);

					if (decoded._tag === 'Left') {
						throw new Error(
							prettyReporter.report(decoded).join('\n'),
						);
					}

					const {
						newBranchName,
						createNewBranch,
						commitMessage,
						pullRequestBody,
						pullRequestTitle,
					} = decoded.right;

					const remotes = repositoryService.getRemotes();
					const remote = (remotes ?? []).find(
						(remote) => remote.pushUrl === decoded.right.remoteUrl,
					);

					if (!remote || !remote.pushUrl) {
						throw new Error('Remote not found');
					}

					const currentBranch = repositoryService.getCurrentBranch();

					const currentBranchName = currentBranch?.name ?? null;

					if (currentBranchName === null) {
						throw new Error('Unable to get current branch');
					}

					if (!createNewBranch) {
						await repositoryService.submitChanges(
							currentBranchName,
							remote.name,
							commitMessage,
						);

						const branchUrl = `${remote.pushUrl}/tree/${currentBranchName}`;
						const messageSelection =
							await vscode.window.showInformationMessage(
								`Changes successfully pushed to the ${currentBranchName} branch: ${branchUrl}`,
								'View on GitHub',
							);

						if (messageSelection === 'View on GitHub') {
							vscode.env.openExternal(
								vscode.Uri.parse(branchUrl),
							);
						}
					} else {
						await repositoryService.submitChanges(
							newBranchName,
							remote.name,
							commitMessage,
						);
						const { html_url } = await sourceControl.createPR({
							title: pullRequestTitle,
							body: pullRequestBody,
							baseBranch: currentBranchName,
							targetBranch: newBranchName,
							remoteUrl: remote.pushUrl,
						});

						const messageSelection =
							await vscode.window.showInformationMessage(
								`Pull request successfully created: ${html_url}`,
								'View on GitHub',
							);

						if (messageSelection === 'View on GitHub') {
							vscode.env.openExternal(vscode.Uri.parse(html_url));
						}
					}

					messageBus.publish({
						kind: MessageKind.updateElements,
					});

					if (remote.pushUrl) {
						repositoryService.setRemoteUrl(remote.pushUrl);
						persistedStateService.saveExtensionState();
					}
				} catch (e) {
					const message =
						isAxiosError<{ message?: string }>(e) &&
						e.response?.data.message
							? e.response.data.message
							: e instanceof Error
							? e.message
							: String(e);
					vscode.window.showErrorMessage(message);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.sourceControl.submitIssue',
			async (arg0) => {
				try {
					const decoded = createIssueParamsCodec.decode(arg0);

					if (decoded._tag === 'Right') {
						const params = decoded.right;

						const { html_url } = await sourceControl.createIssue(
							params,
						);
						const { remoteUrl } = params;

						repositoryService.setRemoteUrl(remoteUrl);

						persistedStateService.saveExtensionState();

						const messageSelection =
							await vscode.window.showInformationMessage(
								`Successfully created issue: ${html_url}`,
								'View on GitHub',
							);

						if (messageSelection === 'View on GitHub') {
							vscode.env.openExternal(vscode.Uri.parse(html_url));
						}
					}
				} catch (e) {
					if (e instanceof NotFoundIntuitaAccount) {
						const result =
							await vscode.window.showInformationMessage(
								'Your extension is not currently connected to your Intuita account. Please sign in and connect your account to the extension to unlock additional features.',
								{ modal: true },
								'Sign In',
							);

						if (result === 'Sign In') {
							vscode.env.openExternal(
								vscode.Uri.parse('https://codemod.studio/'),
							);
						}
					}

					// @TODO create parseError helper or something like that
					const message =
						isAxiosError<{ message?: string }>(e) &&
						e.response?.data.message
							? e.response.data.message
							: e instanceof Error
							? e.message
							: String(e);

					vscode.window.showErrorMessage(message);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.shutdownEngines', () => {
			engineService.shutdownEngines();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.executeCodemods', (arg0) => {
			const { storageUri } = context;

			if (!storageUri) {
				console.error('No storage URI, aborting the command.');
				return;
			}

			const codec = buildTypeCodec({
				path: t.string,
				dependencyName: t.string,
			});

			const validation = codec.decode(arg0);

			if (validation._tag === 'Left') {
				const report = prettyReporter.report(validation);

				console.error(report);

				return;
			}

			const { path, dependencyName } = validation.right;

			const uri = vscode.Uri.file(path);

			const recipeName = dependencyNameToRecipeName[dependencyName];

			if (!recipeName) {
				return;
			}

			const executionId = buildExecutionId();
			const happenedAt = String(Date.now());

			messageBus.publish({
				kind: MessageKind.executeCodemodSet,
				command: {
					engine: 'node',
					storageUri,
					uri,
					recipeName: recipeName,
				},
				executionId,
				happenedAt,
			});
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.clearOutputFiles',
			async () => {
				const { storageUri } = context;

				if (!storageUri) {
					console.error('No storage URI, aborting the command.');
					return;
				}

				await engineService.clearOutputFiles(storageUri);
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.requestFeature', () => {
			vscode.env.openExternal(
				vscode.Uri.parse('https://feedback.intuita.io/'),
			);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.openYouTubeChannel', () => {
			vscode.env.openExternal(
				vscode.Uri.parse(
					'https://www.youtube.com/channel/UCAORbHiie6y5yVaAUL-1nHA',
				),
			);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.acceptJob',
			async (arg0: unknown) => {
				const jobHash = typeof arg0 === 'string' ? arg0 : null;

				if (jobHash === null) {
					throw new Error(
						`Could not decode the first positional arguments: it should have been a string`,
					);
				}

				messageBus.publish({
					kind: MessageKind.acceptJobs,
					jobHashes: new Set([jobHash as JobHash]),
				});
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.rejectJob', async (arg0) => {
			const jobHash: string | null =
				typeof arg0 === 'string' ? arg0 : null;

			if (jobHash === null) {
				throw new Error('Did not pass the jobHash into the command.');
			}

			messageBus.publish({
				kind: MessageKind.rejectJobs,
				jobHashes: new Set([jobHash as JobHash]),
			});
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.sourceControl.saveStagedJobsToTheFileSystem',
			async (arg0: unknown) => {
				try {
					const decoded = applyChangesCoded.decode(arg0);

					if (decoded._tag === 'Left') {
						throw new Error(
							prettyReporter.report(decoded).join('\n'),
						);
					}

					const { jobHashes, diffId: caseHash } = decoded.right;

					await jobManager.acceptJobs(
						new Set(jobHashes as JobHash[]),
					);

					vscode.commands.executeCommand(
						'intuita.rejectCase',
						caseHash,
					);

					vscode.commands.executeCommand('workbench.view.scm');
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					vscode.window.showErrorMessage(message);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.sourceControl.commitStagedJobs',
			async (arg0: unknown) => {
				try {
					const decoded = applyChangesCoded.decode(arg0);

					if (decoded._tag === 'Left') {
						throw new Error(
							prettyReporter.report(decoded).join('\n'),
						);
					}

					const currentBranch = repositoryService.getCurrentBranch();

					if (
						currentBranch === null ||
						currentBranch.name === undefined
					) {
						throw new Error('Unable to get current branch');
					}

					const { jobHashes: appliedJobsHashes } = decoded.right;
					const stagedJobs = [];

					for (const jobHash of appliedJobsHashes) {
						const job = jobManager.getJob(jobHash as JobHash);

						if (job === null) {
							continue;
						}

						stagedJobs.push({
							hash: job.hash.toString(),
							label: buildJobElementLabel(
								job,
								vscode.workspace.workspaceFolders?.[0]?.uri
									.path ?? '',
							),
							codemodName: job.codemodName,
						});
					}

					if (stagedJobs[0] === undefined) {
						throw new Error('Staged jobs not found');
					}

					const firstJobCodemodName = stagedJobs[0].codemodName;

					const newBranchName = branchNameFromStr(
						firstJobCodemodName + randomBytes(16).toString('hex'),
					);

					const initialData = {
						userId: globalStateAccountStorage.getUserAccount(),
					};

					const panelInstance = SourceControlWebviewPanel.getInstance(
						{
							type: 'intuitaPanel',
							title: firstJobCodemodName,
							extensionUri: context.extensionUri,
							initialData,
							viewColumn: vscode.ViewColumn.One,
							webviewName: 'sourceControl',
						},
						messageBus,
					);

					await panelInstance.render();

					const remotes = repositoryService.getRemotes();
					const remoteOptions = (remotes ?? [])
						.map((remote) => remote.pushUrl)
						.filter(isNeitherNullNorUndefined);

					const defaultRemoteUrl = repositoryService.getRemoteUrl();

					if (!defaultRemoteUrl) {
						throw new Error('Remote not found');
					}

					panelInstance.setView({
						viewId: 'commitView',
						viewProps: {
							remoteOptions,
							initialFormData: {
								currentBranchName: currentBranch.name,
								newBranchName,
								remoteUrl: defaultRemoteUrl,
								commitMessage: `Codemod: ${firstJobCodemodName}`,
								createNewBranch: true,
								stagedJobs,
								pullRequestBody: '',
								pullRequestTitle: `[Codemod] ${firstJobCodemodName}`,
							},
							loading: false,
							error: '',
						},
					});
				} catch (e) {
					vscode.window.showErrorMessage(
						e instanceof Error ? e.message : String(e),
					);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.rejectCase', async (arg0) => {
			const caseHash: string | null =
				typeof arg0 === 'string' ? arg0 : null;

			if (caseHash === null) {
				throw new Error('Did not pass the caseHash into the command.');
			}

			messageBus.publish({
				kind: MessageKind.rejectCase,
				caseHash: caseHash as CaseHash,
			});

			messageBus.publish({
				kind: MessageKind.updateElements,
			});

			fileExplorerProvider.setView({
				viewId: 'treeView',
				viewProps: null,
			});
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.acceptFolder',
			async (arg0) => {
				try {
					const codec = buildTypeCodec({
						path: t.string,
						hash: t.string,
						jobHashes: t.readonlyArray(t.string),
					});

					const validation = codec.decode(arg0);

					if (validation._tag === 'Left') {
						const report = prettyReporter.report(validation);

						console.error(report);

						return;
					}

					const {
						path,
						hash,
						jobHashes: _jobHashes,
					} = validation.right;

					const jobHashes = _jobHashes.slice() as JobHash[];

					const currentBranch = repositoryService.getCurrentBranch();

					if (
						currentBranch === null ||
						currentBranch.name === undefined
					) {
						throw new Error('Unable to get current branch');
					}

					// @TODO for now stagedJobs = all case jobs
					const stagedJobs = [];

					for (const jobHash of jobHashes) {
						const job = jobManager.getJob(jobHash);

						if (job === null) {
							continue;
						}

						stagedJobs.push({
							hash: job.hash.toString(),
							label: buildJobElementLabel(
								job,
								vscode.workspace.workspaceFolders?.[0]?.uri
									.path ?? '',
							),
						});
					}

					const newBranchName = `${path}-${hash.toLowerCase()}`;
					const title = path;

					const initialData = {
						userId: globalStateAccountStorage.getUserAccount(),
					};

					const panelInstance = SourceControlWebviewPanel.getInstance(
						{
							type: 'intuitaPanel',
							title,
							extensionUri: context.extensionUri,
							initialData,
							viewColumn: vscode.ViewColumn.One,
							webviewName: 'sourceControl',
						},
						messageBus,
					);

					await panelInstance.render();

					const remotes = repositoryService.getRemotes();
					const remoteOptions = (remotes ?? [])
						.map((remote) => remote.pushUrl)
						.filter(isNeitherNullNorUndefined);

					const defaultRemoteUrl = repositoryService.getRemoteUrl();

					if (!defaultRemoteUrl) {
						throw new Error('Remote not found');
					}

					panelInstance.setView({
						viewId: 'commitView',
						viewProps: {
							remoteOptions,
							initialFormData: {
								currentBranchName: currentBranch.name,
								newBranchName,
								remoteUrl: defaultRemoteUrl,
								commitMessage: '',
								createNewBranch: true,
								stagedJobs,
							},
							loading: false,
							error: '',
						},
					});
				} catch (e) {
					vscode.window.showErrorMessage(
						e instanceof Error ? e.message : String(e),
					);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.rejectFolder',
			async (arg0, ...otherArgs) => {
				const firstJobHash: string | null =
					typeof arg0 === 'string' ? arg0 : null;
				if (firstJobHash === null) {
					throw new Error(
						'Did not pass the jobHashes into the command.',
					);
				}
				const jobHashes = [arg0].concat(otherArgs.slice());

				messageBus.publish({
					kind: MessageKind.rejectJobs,
					jobHashes: new Set(jobHashes),
				});
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.openTopLevelNodeKindOrderSetting',
			() => {
				return vscode.commands.executeCommand(
					'workbench.action.openSettings',
					'intuita.topLevelNodeKindOrder',
				);
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeAsCodemod',
			(uri: vscode.Uri) => {
				const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;

				if (!rootUri) {
					throw new Error('No workspace has been opened.');
				}

				const { storageUri } = context;

				if (!storageUri) {
					throw new Error('No storage URI, aborting the command.');
				}

				const happenedAt = String(Date.now());
				const executionId = buildExecutionId();

				messageBus.publish({
					kind: MessageKind.executeCodemodSet,
					command: {
						uri: rootUri,
						engine: 'node',
						storageUri,
						fileUri: uri,
					},
					happenedAt,
					executionId,
				});
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeCodemod',
			async (uri: vscode.Uri, hashDigest: CodemodHash) => {
				try {
					const { storageUri } = context;

					if (!storageUri) {
						throw new Error(
							'No storage URI, aborting the command.',
						);
					}

					const executionId = buildExecutionId();
					const happenedAt = String(Date.now());

					messageBus.publish({
						kind: MessageKind.executeCodemodSet,
						command: {
							kind: 'executeCodemod',
							engine: 'node',
							storageUri,
							codemodHash: hashDigest,
							uri,
						},
						executionId,
						happenedAt,
					});

					vscode.commands.executeCommand(
						'workbench.view.extension.intuitaViewId',
					);

					// opens "Code Change Projects" panel if not opened
					campaignManagerProvider.showView();
				} catch (e) {
					vscode.window.showErrorMessage(
						e instanceof Error ? e.message : String(e),
					);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeCodemodWithinPath',
			async (uri: vscode.Uri) => {
				try {
					const { storageUri } = context;

					if (!storageUri) {
						throw new Error(
							'No storage URI, aborting the command.',
						);
					}

					const codemodList = await engineService.getCodemodList();

					const codemodName =
						(await vscode.window.showQuickPick(
							codemodList.map(({ name }) => name),
							{
								placeHolder:
									'Pick a codemod to execute over the selected path',
							},
						)) ?? null;

					if (codemodName === null) {
						return;
					}

					const selectedCodemod = codemodList.find(
						({ name }) => name === codemodName,
					);

					if (!selectedCodemod) {
						throw new Error('Codemod is not selected');
					}

					const executionId = buildExecutionId();
					const happenedAt = String(Date.now());

					messageBus.publish({
						kind: MessageKind.executeCodemodSet,
						command: {
							kind: 'executeCodemod',
							engine: 'node',
							storageUri,
							codemodHash:
								selectedCodemod.hashDigest as CodemodHash,
							uri,
						},
						executionId,
						happenedAt,
					});

					vscode.commands.executeCommand(
						'workbench.view.extension.intuitaViewId',
					);

					// opens "Code Change Projects" panel if not opened
					campaignManagerProvider.showView();
				} catch (e) {
					vscode.window.showErrorMessage(
						e instanceof Error ? e.message : String(e),
					);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeRecipeWithinPath',
			async (uri: vscode.Uri) => {
				const { storageUri } = context;

				if (!storageUri) {
					throw new Error('No storage URI, aborting the command.');
				}

				const projectName = await vscode.window.showQuickPick(
					PROJECT_NAMES.slice(),
					{
						placeHolder:
							'Pick the project to execute a codemod set (recipe) over the selected path',
					},
				);

				if (!projectNameCodec.is(projectName)) {
					return;
				}

				const recipeMap = RECIPE_MAP.get(projectName);

				if (!recipeMap) {
					return;
				}

				let version = await vscode.window.showQuickPick(
					Object.keys(recipeMap).map((version) =>
						!isNaN(parseFloat(version)) ? `v${version}` : version,
					),
					{
						placeHolder:
							'Pick the codemod set (recipe) to execute over the selected path',
					},
				);

				if (!version) {
					return;
				}

				if (
					version.startsWith('v') &&
					!isNaN(parseFloat(version.slice(1)))
				) {
					version = version.slice(1);
				}

				const recipeName = recipeMap[version];

				if (!recipeNameCodec.is(recipeName)) {
					return;
				}

				const executionId = buildExecutionId();
				const happenedAt = String(Date.now());

				const command: Command =
					recipeName === 'redwoodjs_experimental'
						? {
								kind: 'repomod',
								engine: 'node',
								repomodFilePath: recipeName,
								storageUri,
								inputPath: uri,
						  }
						: {
								engine: 'node',
								storageUri,
								recipeName,
								uri,
						  };

				messageBus.publish({
					kind: MessageKind.executeCodemodSet,
					command,
					executionId,
					happenedAt,
				});
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeImportedModOnPath',
			async (uri: vscode.Uri) => {
				const { storageUri } = context;

				if (!storageUri) {
					throw new Error('No storage URI, aborting the command.');
				}

				const modUri = vscode.Uri.joinPath(
					storageUri,
					'jscodeshiftCodemod.ts',
				);

				const document = await vscode.workspace.openTextDocument(
					intuitaTextDocumentContentProvider.URI,
				);

				const text = document.getText();

				// `jscodeshiftCodemod.ts` is empty or the file doesn't exist
				if (!text) {
					vscode.window.showWarningMessage(Messages.noImportedMod);
					return;
				}

				const buffer = Buffer.from(text);
				const content = new Uint8Array(buffer);
				vscode.workspace.fs.writeFile(modUri, content);

				const happenedAt = String(Date.now());
				const executionId = buildExecutionId();

				messageBus.publish({
					kind: MessageKind.executeCodemodSet,
					command: {
						uri,
						engine: 'node',
						storageUri,
						fileUri: modUri,
					},
					happenedAt,
					executionId,
				});
			},
		),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration('intuita')) {
				return;
			}

			messageBus.publish({
				kind: MessageKind.configurationChanged,
				nextConfiguration: getConfiguration(),
			});

			messageBus.publish({
				kind: MessageKind.updateElements,
			});
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.clearState', () => {
			messageBus.publish({
				kind: MessageKind.clearState,
			});
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.sendAsBeforeSnippet',
			async () => {
				const { activeTextEditor } = vscode.window;

				if (!activeTextEditor) {
					console.error(
						'No active text editor, sendAsBeforeSnippet will not be executed',
					);
					return;
				}

				const selection = activeTextEditor.selection;
				const text = activeTextEditor.document.getText(selection);

				const beforeSnippet = Buffer.from(text).toString('base64url');

				const uri = vscode.Uri.parse(
					`https://codemod.studio?beforeSnippet=${beforeSnippet}`,
				);

				await vscode.env.openExternal(uri);
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.sendAsAfterSnippet',
			async () => {
				const { activeTextEditor } = vscode.window;

				if (!activeTextEditor) {
					console.error(
						'No active text editor, sendAsAfterSnippet will not be executed',
					);
					return;
				}

				const selection = activeTextEditor.selection;
				const text = activeTextEditor.document.getText(selection);

				const afterSnippet = Buffer.from(text).toString('base64url');

				const uri = vscode.Uri.parse(
					`https://codemod.studio?afterSnippet=${afterSnippet}`,
				);

				await vscode.env.openExternal(uri);
			},
		),
	);

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(
			'intuita',
			intuitaTextDocumentContentProvider,
		),
	);

	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri: async (uri) => {
				const searchParams = new URLSearchParams(uri.query);
				const base64UrlEncodedContent = searchParams.get('c');
				const userId = searchParams.get('userId');
				const codemodHashDigest = searchParams.get('chd');

				if (base64UrlEncodedContent) {
					const buffer = Buffer.from(
						base64UrlEncodedContent,
						'base64url',
					);

					const content = buffer.toString('utf8');

					intuitaTextDocumentContentProvider.setContent(content);

					const document = await vscode.workspace.openTextDocument(
						intuitaTextDocumentContentProvider.URI,
					);

					vscode.window.showTextDocument(document);
				} else if (userId) {
					try {
						userService.linkUsersIntuitaAccount(userId);
					} catch (e) {
						if (e instanceof AlreadyLinkedError) {
							const result =
								await vscode.window.showInformationMessage(
									'It seems like your extension is already linked to another Intuita account. Would you like to link it to your new Intuita account instead?',
									{ modal: true },
									'Link account',
								);

							if (result === 'Link account') {
								userService.unlinkUserIntuitaAccount();
								userService.linkUsersIntuitaAccount(userId);
							}
						}
					}
				} else if (codemodHashDigest !== null) {
					messageBus.publish({
						kind: MessageKind.focusCodemod,
						codemodHashDigest: codemodHashDigest as CodemodHash,
					});

					vscode.commands.executeCommand(
						'workbench.view.extension.intuitaViewId',
					);
				}
			},
		}),
	);

	messageBus.publish({
		kind: MessageKind.updateElements,
	});

	// const dependencyService = new DependencyService(messageBus);

	// dependencyService.showInformationMessagesAboutUpgrades();

	new InformationMessageService(messageBus, () => context.storageUri ?? null);

	{
		const codec = buildTypeCodec({ version: t.string });

		const validation = codec.decode(context.extension.packageJSON);
		const version =
			validation._tag === 'Right' ? validation.right.version : null;

		new TelemetryService(configurationContainer, messageBus, version);
	}

	messageBus.publish({
		kind: MessageKind.bootstrapEngines,
	});

	messageBus.publish({ kind: MessageKind.extensionActivated });
}

export function deactivate() {
	messageBus.publish({ kind: MessageKind.extensionDeactivated });
}
