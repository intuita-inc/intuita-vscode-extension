import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import TelemetryReporter from '@vscode/extension-telemetry';
import { getConfiguration, setConfigurationProperty } from './configuration';
import { buildContainer } from './container';
import { Command, MessageBus, MessageKind } from './components/messageBus';
import { JobManager } from './components/jobManager';
import { FileService } from './components/fileService';
import { CaseHash, caseHashCodec } from './cases/types';
import { DownloadService } from './components/downloadService';
import { FileSystemUtilities } from './components/fileSystemUtilities';
import { EngineService, Messages } from './components/engineService';
import { BootstrapExecutablesService } from './components/bootstrapExecutablesService';
import { buildCaseHash } from './telemetry/hashes';
import { IntuitaTextDocumentContentProvider } from './components/textDocumentContentProvider';
import { CodemodHash } from './packageJsonAnalyzer/types';
import { VscodeTelemetry } from './telemetry/vscodeTelemetry';
import prettyReporter from 'io-ts-reporters';
import { ErrorWebviewProvider } from './components/webview/ErrorWebviewProvider';
import { MainViewProvider } from './components/webview/MainProvider';
import { buildStore } from './data';
import { actions } from './data/slice';
import { IntuitaPanelProvider } from './components/webview/IntuitaPanelProvider';
import { CaseManager } from './cases/caseManager';
import { CodemodDescriptionProvider } from './components/webview/CodemodDescriptionProvider';
import { selectExplorerTree } from './selectors/selectExplorerTree';
import { CodemodNodeHashDigest } from './selectors/selectCodemodTree';
import { doesJobAddNewFile } from './selectors/comparePersistedJobs';
import { JobHash, mapPersistedJobToJob } from './jobs/types';
import { DEFAULT_PRETTIER_OPTIONS, formatText, getConfig } from './formatter';
import { Options } from 'prettier';
import { LeftRightHashSetManager } from './leftRightHashes/leftRightHashSetManager';

const messageBus = new MessageBus();

export async function activate(context: vscode.ExtensionContext) {
	const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri ?? null;

	if (rootUri === null) {
		return;
	}

	messageBus.setDisposables(context.subscriptions);

	const { store } = await buildStore(context.workspaceState);

	const configurationContainer = buildContainer(getConfiguration());

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(() => {
			configurationContainer.set(getConfiguration());
		}),
	);

	const fileService = new FileService(messageBus);

	const jobManager = new JobManager(fileService, messageBus, store);

	new CaseManager(messageBus, store);

	const fileSystemUtilities = new FileSystemUtilities(vscode.workspace.fs);

	const downloadService = new DownloadService(
		vscode.workspace.fs,
		fileSystemUtilities,
	);

	const engineService = new EngineService(
		configurationContainer,
		messageBus,
		vscode.workspace.fs,
		store,
	);

	new BootstrapExecutablesService(
		downloadService,
		context.globalStorageUri,
		vscode.workspace.fs,
		messageBus,
	);

	const intuitaTextDocumentContentProvider =
		new IntuitaTextDocumentContentProvider();

	const telemetryKey = '63abdc2f-f7d2-4777-a320-c0e596a6f114';
	const vscodeTelemetry = new VscodeTelemetry(
		new TelemetryReporter(telemetryKey),
		messageBus,
	);

	const mainViewProvider = new MainViewProvider(
		context,
		engineService,
		messageBus,
		rootUri,
		store,
	);

	const mainView = vscode.window.registerWebviewViewProvider(
		'intuitaMainView',
		mainViewProvider,
	);

	const codemodDescriptionProvider = new CodemodDescriptionProvider(
		downloadService,
		vscode.workspace.fs,
		context.globalStorageUri,
		messageBus,
		store,
	);

	new IntuitaPanelProvider(
		context.extensionUri,
		store,
		mainViewProvider,
		messageBus,
		codemodDescriptionProvider,
		rootUri.fsPath,
		jobManager,
	);

	context.subscriptions.push(mainView);

	const errorWebviewProvider = new ErrorWebviewProvider(
		context,
		messageBus,
		store,
		mainViewProvider,
	);

	// this is only used by the intuita panel's webview
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
		vscode.commands.registerCommand(
			'intuita.sourceControl.saveStagedJobsToTheFileSystem',
			async (arg0: unknown) => {
				try {
					store.dispatch(actions.setApplySelectedInProgress(true));

					const validation = caseHashCodec.decode(arg0);

					if (validation._tag === 'Left') {
						throw new Error(
							prettyReporter.report(validation).join('\n'),
						);
					}

					const caseHashDigest = validation.right;

					const state = store.getState();

					const tree = selectExplorerTree(
						state,
						vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
							'',
					);

					if (tree === null) {
						store.dispatch(
							actions.setApplySelectedInProgress(false),
						);
						return;
					}

					const { selectedJobHashes } = tree;

					await jobManager.acceptJobs(new Set(selectedJobHashes));

					store.dispatch(
						actions.clearSelectedExplorerNodes(caseHashDigest),
					);
					store.dispatch(
						actions.clearIndeterminateExplorerNodes(caseHashDigest),
					);

					vscode.commands.executeCommand('workbench.view.scm');
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					vscodeTelemetry.sendError({
						kind: 'failedToExecuteCommand',
						commandName:
							'intuita.sourceControl.saveStagedJobsToTheFileSystem',
					});
					vscode.window.showErrorMessage(message);
				} finally {
					store.dispatch(actions.setApplySelectedInProgress(false));
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.rejectCase', async (arg0) => {
			try {
				const caseHash: string | null =
					typeof arg0 === 'string' ? arg0 : null;

				if (caseHash === null) {
					throw new Error(
						'Did not pass the caseHash into the command.',
					);
				}

				messageBus.publish({
					kind: MessageKind.rejectCase,
					caseHash: caseHash as CaseHash,
				});
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				vscode.window.showErrorMessage(message);

				vscodeTelemetry.sendError({
					kind: 'failedToExecuteCommand',
					commandName: 'intuita.rejectCase',
				});
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeAsCodemod',
			async (codemodUri: vscode.Uri) => {
				try {
					const targetUri =
						vscode.workspace.workspaceFolders?.[0]?.uri ?? null;

					if (targetUri == null) {
						throw new Error('No workspace has been opened.');
					}

					const { storageUri } = context;

					if (!storageUri) {
						throw new Error(
							'No storage URI, aborting the command.',
						);
					}

					const happenedAt = String(Date.now());

					const fileStat = await vscode.workspace.fs.stat(targetUri);
					const targetUriIsDirectory = Boolean(
						fileStat.type & vscode.FileType.Directory,
					);

					messageBus.publish({
						kind: MessageKind.executeCodemodSet,
						command: {
							kind: 'executeLocalCodemod',
							codemodUri,
							name: codemodUri.fsPath,
						},
						happenedAt,
						caseHashDigest: buildCaseHash(),
						storageUri,
						targetUri,
						targetUriIsDirectory,
					});
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					vscode.window.showErrorMessage(message);

					vscodeTelemetry.sendError({
						kind: 'failedToExecuteCommand',
						commandName: 'intuita.executeAsCodemod',
					});
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeAsPiranhaRule',
			async (configurationUri: vscode.Uri) => {
				const fileStat = await vscode.workspace.fs.stat(
					configurationUri,
				);
				const configurationUriIsDirectory = Boolean(
					fileStat.type & vscode.FileType.Directory,
				);

				if (!configurationUriIsDirectory) {
					throw new Error(
						`To execute a configuration URI as a Piranha rule, it has to be a directory`,
					);
				}

				const targetUri =
					vscode.workspace.workspaceFolders?.[0]?.uri ?? null;

				if (targetUri == null) {
					throw new Error('No workspace has been opened.');
				}

				const { storageUri } = context;

				if (!storageUri) {
					throw new Error('No storage URI, aborting the command.');
				}

				const language =
					(await vscode.window.showQuickPick(['java', 'ts', 'tsx'], {
						title: 'Select the language to run Piranha against',
					})) ?? null;

				if (language == null) {
					throw new Error('You must specify the language');
				}

				messageBus.publish({
					kind: MessageKind.executeCodemodSet,
					command: {
						kind: 'executePiranhaRule',
						configurationUri,
						language,
						name: configurationUri.fsPath,
					},
					happenedAt: String(Date.now()),
					caseHashDigest: buildCaseHash(),
					storageUri,
					targetUri,
					targetUriIsDirectory: configurationUriIsDirectory,
				});
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeCodemod',
			async (targetUri: vscode.Uri, codemodHash: CodemodHash) => {
				try {
					const { storageUri } = context;

					if (!storageUri) {
						throw new Error(
							'No storage URI, aborting the command.',
						);
					}

					const happenedAt = String(Date.now());

					const fileStat = await vscode.workspace.fs.stat(targetUri);
					const targetUriIsDirectory = Boolean(
						fileStat.type & vscode.FileType.Directory,
					);

					const codemod =
						store.getState().codemod.entities[codemodHash] ?? null;

					if (codemod === null) {
						throw new Error(
							'No codemod was found with the provided hash digest.',
						);
					}

					const command: Command =
						codemod.kind === 'piranhaRule'
							? {
									kind: 'executePiranhaRule',
									configurationUri: vscode.Uri.joinPath(
										context.globalStorageUri,
										codemod.configurationDirectoryBasename,
									),
									language: codemod.language,
									name: codemod.name,
							  }
							: {
									kind:
										codemodHash ===
										'QKEdp-pofR9UnglrKAGDm1Oj6W0'
											? 'executeRepomod'
											: 'executeCodemod',
									codemodHash,
									name: codemod.name,
							  };

					messageBus.publish({
						kind: MessageKind.executeCodemodSet,
						command,
						caseHashDigest: buildCaseHash(),
						happenedAt,
						targetUri,
						targetUriIsDirectory,
						storageUri,
					});

					vscode.commands.executeCommand(
						'workbench.view.extension.intuitaViewId',
					);
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					vscode.window.showErrorMessage(message);

					vscodeTelemetry.sendError({
						kind: 'failedToExecuteCommand',
						commandName: 'intuita.executeCodemod',
					});
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeCodemodWithinPath',
			async (uriArg: vscode.Uri | null | undefined) => {
				try {
					const { storageUri } = context;

					if (!storageUri) {
						throw new Error(
							'No storage URI, aborting the command.',
						);
					}

					const targetUri =
						uriArg ??
						vscode.window.activeTextEditor?.document.uri ??
						null;

					if (targetUri === null) {
						return;
					}

					const codemodList = await engineService.getCodemodList();

					// order: least recent to most recent
					const top3RecentCodemodHashes =
						store.getState().lastCodemodHashDigests;

					const top3RecentCodemods = codemodList.filter((codemod) =>
						top3RecentCodemodHashes.includes(
							codemod.hashDigest as CodemodHash,
						),
					);

					// order: least recent to most recent
					top3RecentCodemods.sort((a, b) => {
						return (
							top3RecentCodemodHashes.indexOf(
								a.hashDigest as CodemodHash,
							) -
							top3RecentCodemodHashes.indexOf(
								b.hashDigest as CodemodHash,
							)
						);
					});
					const sortedCodemodList = [
						...top3RecentCodemods.reverse(),
						...codemodList.filter(
							(codemod) =>
								!top3RecentCodemodHashes.includes(
									codemod.hashDigest as CodemodHash,
								),
						),
					];

					const quickPickItem =
						(await vscode.window.showQuickPick(
							sortedCodemodList.map(({ name, hashDigest }) => ({
								label: name,
								...(top3RecentCodemodHashes.includes(
									hashDigest as CodemodHash,
								) && { description: '(recent)' }),
							})),
							{
								placeHolder:
									'Pick a codemod to execute over the selected path',
							},
						)) ?? null;

					if (quickPickItem === null) {
						return;
					}

					const codemodEntry =
						sortedCodemodList.find(
							({ name }) => name === quickPickItem.label,
						) ?? null;

					if (codemodEntry === null) {
						throw new Error('Codemod is not selected');
					}

					await mainViewProvider.updateExecutionPath({
						newPath: targetUri.path,
						codemodHash: codemodEntry.hashDigest as CodemodHash,
						fromVSCodeCommand: true,
						errorMessage: null,
						warningMessage: null,
						revertToPrevExecutionIfInvalid: false,
					});

					vscode.commands.executeCommand(
						'workbench.view.extension.intuitaViewId',
					);

					store.dispatch(
						actions.setFocusedCodemodHashDigest(
							codemodEntry.hashDigest as unknown as CodemodNodeHashDigest,
						),
					);

					const fileStat = await vscode.workspace.fs.stat(targetUri);
					const targetUriIsDirectory = Boolean(
						fileStat.type & vscode.FileType.Directory,
					);

					const command: Command =
						codemodEntry.kind === 'piranhaRule'
							? {
									kind: 'executePiranhaRule',
									configurationUri: vscode.Uri.joinPath(
										context.globalStorageUri,
										codemodEntry.configurationDirectoryBasename,
									),
									language: codemodEntry.language,
									name: codemodEntry.name,
							  }
							: {
									kind: 'executeCodemod',
									codemodHash:
										codemodEntry.hashDigest as CodemodHash,
									name: codemodEntry.name,
							  };

					messageBus.publish({
						kind: MessageKind.executeCodemodSet,
						command,
						caseHashDigest: buildCaseHash(),
						happenedAt: String(Date.now()),
						storageUri,
						targetUri,
						targetUriIsDirectory,
					});
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					vscode.window.showErrorMessage(message);

					vscodeTelemetry.sendError({
						kind: 'failedToExecuteCommand',
						commandName: 'intuita.executeCodemodWithinPath',
					});
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeImportedModOnPath',
			async (targetUri: vscode.Uri) => {
				try {
					const { storageUri } = context;

					if (!storageUri) {
						throw new Error(
							'No storage URI, aborting the command.',
						);
					}

					const codemodUri = vscode.Uri.joinPath(
						storageUri,
						'jscodeshiftCodemod.ts',
					);

					const document = await vscode.workspace.openTextDocument(
						intuitaTextDocumentContentProvider.URI,
					);

					const text = document.getText();

					// `jscodeshiftCodemod.ts` is empty or the file doesn't exist
					if (!text) {
						vscode.window.showWarningMessage(
							Messages.noImportedMod,
						);
						return;
					}

					const buffer = Buffer.from(text);
					const content = new Uint8Array(buffer);
					vscode.workspace.fs.writeFile(codemodUri, content);

					const fileStat = await vscode.workspace.fs.stat(targetUri);
					const targetUriIsDirectory = Boolean(
						fileStat.type & vscode.FileType.Directory,
					);

					messageBus.publish({
						kind: MessageKind.executeCodemodSet,
						command: {
							kind: 'executeLocalCodemod',
							codemodUri,
							name: codemodUri.fsPath,
						},
						happenedAt: String(Date.now()),
						caseHashDigest: buildCaseHash(),
						storageUri,
						targetUri,
						targetUriIsDirectory,
					});
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					vscode.window.showErrorMessage(message);

					vscodeTelemetry.sendError({
						kind: 'failedToExecuteCommand',
						commandName: 'intuita.executeImportedModOnPath',
					});
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('intuita.clearState', () => {
			const state = store.getState();

			const uris: vscode.Uri[] = [];

			for (const job of Object.values(state.job.entities)) {
				if (
					!job ||
					!doesJobAddNewFile(job.kind) ||
					job.newContentUri === null
				) {
					continue;
				}

				uris.push(vscode.Uri.parse(job.newContentUri));
			}

			store.dispatch(actions.clearState());

			messageBus.publish({
				kind: MessageKind.deleteFiles,
				uris,
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
				} else if (codemodHashDigest !== null) {
					vscode.commands.executeCommand(
						'workbench.view.extension.intuitaViewId',
					);

					store.dispatch(
						actions.setFocusedCodemodHashDigest(
							codemodHashDigest as unknown as CodemodNodeHashDigest,
						),
					);
				}
			},
		}),
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'intuitaErrorViewId',
			errorWebviewProvider,
		),
	);

	messageBus.publish({
		kind: MessageKind.bootstrapEngine,
	});

	const intuitaCustomConfigPrompt = async (): Promise<boolean> => {
		const positiveChoice = 'Yes, use default';
		const negativeChoice = 'Cancel';

		const choice = await vscode.window.showWarningMessage(
			`Unable to resolve config. Would you like to use the Intuita's custom configuration instead?`,
			positiveChoice,
			negativeChoice,
		);

		return choice === positiveChoice;
	};

	const getFormatterConfig = async (): Promise<Options | null> => {
		try {
			return await getConfig(rootUri.fsPath);
		} catch (e) {
			const { useCustomPrettierConfig } = configurationContainer.get();

			
			// if (useCustomPrettierConfig === null) {
			// 	const shouldUseCustomConfig = await intuitaCustomConfigPrompt();

			// 	setConfigurationProperty(
			// 		'useCustomPrettierConfig',
			// 		shouldUseCustomConfig,
			// 		vscode.ConfigurationTarget.Workspace,
			// 	);

			// 	if (shouldUseCustomConfig) {
			// 		return DEFAULT_PRETTIER_OPTIONS;
			// 	}
			// }

			if (useCustomPrettierConfig) {
				return DEFAULT_PRETTIER_OPTIONS;
			}

			return null;
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.formatCaseJobs',
			async (arg0: unknown) => {
				try {
					const validation = caseHashCodec.decode(arg0);

					if (validation._tag === 'Left') {
						throw new Error(
							prettyReporter.report(validation).join('\n'),
						);
					}
					const state = store.getState();

					const caseHash = validation.right;

					const caseHashJobHashSetManager =
						new LeftRightHashSetManager<CaseHash, JobHash>(
							new Set(state.caseHashJobHashes),
						);

					const caseJobHashes =
						caseHashJobHashSetManager.getRightHashesByLeftHash(
							caseHash,
						);

					const formatterConfig = await getFormatterConfig();

					if (formatterConfig === null) {
						throw new Error('Unable to resolve Prettier config');
					}

					for (const jobHash of caseJobHashes) {
						const persistedJob =
							store.getState().job.entities[jobHash];

						const newContentUri = persistedJob
							? mapPersistedJobToJob(persistedJob)?.newContentUri
							: null;

						if (newContentUri === null) {
							continue;
						}

						const newContent = readFileSync(
							newContentUri.fsPath,
							'utf8',
						);

						const formattedText = await formatText(
							newContent,
							formatterConfig,
						);

						await jobManager.changeJobContent(
							jobHash,
							formattedText,
						);
					}
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					vscode.window.showErrorMessage(message);

					vscodeTelemetry.sendError({
						kind: 'failedToExecuteCommand',
						commandName: 'intuita.formatCaseJobs',
					});
				}
			},
		),
	);
}
