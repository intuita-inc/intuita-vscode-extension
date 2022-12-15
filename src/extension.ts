import * as vscode from 'vscode';
import { getConfiguration } from './configuration';
import { buildContainer } from './container';
import { MessageBus, MessageKind } from './components/messageBus';
import { JobManager } from './components/jobManager';
import { IntuitaTreeDataProvider } from './components/intuitaTreeDataProvider';
import { FileService } from './components/fileService';
import { JobHash } from './jobs/types';
import { CaseManager } from './cases/caseManager';
import { CaseHash } from './cases/types';
import { DownloadService } from './components/downloadService';
import { FileSystemUtilities } from './components/fileSystemUtilities';
import { NoraCompareServiceEngine } from './components/noraCompareServiceEngine';
import { EngineService } from './components/engineService';
import { BootstrapExecutablesService } from './components/bootstrapExecutablesService';

const messageBus = new MessageBus();

export async function activate(context: vscode.ExtensionContext) {
	messageBus.setDisposables(context.subscriptions);

	const configurationContainer = buildContainer(getConfiguration());

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(() => {
			configurationContainer.set(getConfiguration());
		}),
	);

	const jobManager = new JobManager(messageBus);

	const caseManager = new CaseManager(messageBus);

	new FileService(messageBus);

	const treeDataProvider = new IntuitaTreeDataProvider(
		caseManager,
		configurationContainer,
		messageBus,
		jobManager,
	);

	const explorerTreeView = vscode.window.createTreeView(
		'explorerIntuitaViewId',
		{ treeDataProvider },
	);

	const intuitaTreeView = vscode.window.createTreeView('intuitaViewId', {
		treeDataProvider,
	});

	treeDataProvider.setReveal(explorerTreeView.reveal);

	context.subscriptions.push(explorerTreeView);
	context.subscriptions.push(intuitaTreeView);

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
	statusBarItem.text = 'Intuita';

	context.subscriptions.push(statusBarItem);

	const engineService = new EngineService(
		messageBus,
		vscode.workspace.fs,
		statusBarItem,
	);

	new BootstrapExecutablesService(
		downloadService,
		context.globalStorageUri,
		vscode.workspace.fs,
		messageBus,
		statusBarItem,
	);

	new NoraCompareServiceEngine(messageBus);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.shutdownEngines',
			() => {
				engineService.shutdownEngines();
			}
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeNextJsCodemods',
			async () => {
				const { storageUri } = context;

				if (!storageUri) {
					console.error('No storage URI, aborting the command.');
					return;
				}

				messageBus.publish({
					kind: MessageKind.bootstrapExecutables,
					command: {
						engine: 'node',
						storageUri,
						group: 'nextJs',
					},
				});
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executePagesToAppsCodemods',
			async () => {
				const { storageUri } = context;

				if (!storageUri) {
					console.error('No storage URI, aborting the command.');
					return;
				}

				messageBus.publish({
					kind: MessageKind.bootstrapExecutables,
					command: {
						engine: 'rust',
						storageUri,
						group: 'nextJs',
					},
				});
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.executeMuiCodemods',
			async () => {
				const { storageUri } = context;

				if (!storageUri) {
					console.error('No storage URI, aborting the command.');
					return;
				}

				messageBus.publish({
					kind: MessageKind.bootstrapExecutables,
					command: {
						engine: 'node',
						storageUri,
						group: 'mui',
					},
				});
			},
		),
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
					jobHash: jobHash as JobHash,
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
		vscode.commands.registerCommand('intuita.acceptCase', async (arg0) => {
			const caseHash: string | null =
				typeof arg0 === 'string' ? arg0 : null;

			if (caseHash === null) {
				throw new Error('Did not pass the caseHash into the command.');
			}

			messageBus.publish({
				kind: MessageKind.acceptCase,
				caseHash: caseHash as CaseHash,
			});
		}),
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
		}),
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
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration('intuita')) {
				return;
			}

			messageBus.publish({
				kind: MessageKind.updateElements,
				trigger: 'onDidUpdateConfiguration',
			});
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.showOrHideFileElements',
			() => {
				const configuration =
					vscode.workspace.getConfiguration('intuita');

				const showFileElements =
					configuration.get<boolean>('showFileElements') ?? false;

				configuration.update('showFileElements', !showFileElements);
			},
		),
	);
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() {}
