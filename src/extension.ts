import * as vscode from 'vscode';
import {
	Diagnostic,
	DiagnosticSeverity,
	Position,
	Range,
} from 'vscode';
import {MoveTopLevelNodeActionProvider} from './actionProviders/moveTopLevelNodeActionProvider';
import {getConfiguration} from './configuration';
import {MoveTopLevelNodeJobManager, MoveTopLevelNodeJob} from "./features/moveTopLevelNode/moveTopLevelNodeJobManager";
import { buildContainer } from "./container";
import { JobHash } from './features/moveTopLevelNode/jobHash';
import { IntuitaFileSystem } from './fileSystems/intuitaFileSystem';
import { MessageBus, MessageKind } from './messageBus';
import { buildDidChangeDiagnosticsCallback } from './languages/buildDidChangeDiagnosticsCallback';
import { buildTreeDataProvider } from './treeDataProviders';
import {buildMoveTopLevelNodeCommand} from "./commands/moveTopLevelNodeCommand";
import {OnnxWrapper} from "./components/onnxWrapper";
import {RepairCodeJob, RepairCodeJobManager} from "./features/repairCode/repairCodeJobManager";

export async function activate(
	context: vscode.ExtensionContext,
) {
	const messageBus = new MessageBus(context.subscriptions);
	const onnxWrapper = new OnnxWrapper(messageBus);

	const configurationContainer = buildContainer(
		getConfiguration()
	);

	const intuitaFileSystem = new IntuitaFileSystem(
		messageBus,
	);

	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider(
			'intuita',
			intuitaFileSystem,
			{
				isCaseSensitive: true
			}
		),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(
			() => {
				configurationContainer.set(
					getConfiguration()
				);
			}
		)
	);

	const diagnosticCollection = vscode
		.languages
		.createDiagnosticCollection(
			'typescript'
		);

	const moveTopLevelNodeJobManager = new MoveTopLevelNodeJobManager(
		messageBus,
		configurationContainer,
		_setDiagnosticEntry,
	);

	const repairCodeJobManager = new RepairCodeJobManager(
		messageBus,
		_setDiagnosticEntry,
	);

	const treeDataProvider = buildTreeDataProvider(
		moveTopLevelNodeJobManager,
		repairCodeJobManager,
	);

	function _setDiagnosticEntry(
		fileName: string,
		jobs: ReadonlyArray<MoveTopLevelNodeJob | RepairCodeJob>,
	) {
		const uri = vscode.Uri.parse(fileName);

		diagnosticCollection.get(uri);

		const diagnostics = jobs
			.map(
				({ kind, title, range: intuitaRange }) => {
					const startPosition = new Position(
						intuitaRange[0],
						intuitaRange[1],
					);

					const endPosition = new Position(
						intuitaRange[2],
						intuitaRange[3],
					);

					const range = new Range(
						startPosition,
						endPosition,
					);

					const diagnostic = new Diagnostic(
						range,
						title,
						DiagnosticSeverity.Information
					);

					diagnostic.code = kind.valueOf();

					return diagnostic;
				}
			);

		diagnosticCollection.clear();

		diagnosticCollection.set(
			uri,
			diagnostics,
		);

		treeDataProvider._onDidChangeTreeData.fire();
	}

	messageBus.subscribe(
		(message) => {
			if (message.kind === MessageKind.readingFileFailed) {
				setImmediate(
					() => moveTopLevelNodeJobManager.onReadingFileFailed(
						message.uri,
					),
				);
			}
		},
	);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(
			'explorerIntuitaViewId',
			treeDataProvider
		)
	);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(
			'intuitaViewId',
			treeDataProvider
		)
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			'typescript',
			new MoveTopLevelNodeActionProvider(
				moveTopLevelNodeJobManager,
			)
		));


	const activeTextEditorChangedCallback = (
		document: vscode.TextDocument,
	) => {
		moveTopLevelNodeJobManager
			.onFileTextChanged(
				document,
			);
	};

	if (vscode.window.activeTextEditor) {
		activeTextEditorChangedCallback(
			vscode
				.window
				.activeTextEditor
				.document,
		);
	}

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(
			(textEditor) => {
				if (!textEditor) {
					return;
				}

				return activeTextEditorChangedCallback(
					textEditor
						.document,
				);
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.requestFeature',
			() => {
				vscode.env.openExternal(
					vscode.Uri.parse('https://feedback.intuita.io/')
				);
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.acceptJob',
			async (args) => {
				const jobHash: string | null = (typeof args === 'object' && typeof args.hash === 'string')
					? args.hash
					: null;

				if (jobHash === null) {
					throw new Error('Did not pass the job hash argument "hash".');
				}

				await vscode.commands.executeCommand(
					'intuita.moveTopLevelNode',
					jobHash,
					0, // characterDifference
				);
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.rejectJob',
			async (args) => {
				const jobHash: string | null = (typeof args === 'object' && typeof args.hash === 'string')
					? args.hash
					: null;

				if (jobHash === null) {
					throw new Error('Did not pass the job hash argument "hash".');
				}

				moveTopLevelNodeJobManager.rejectJob(
					jobHash as JobHash,
				);
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.openTopLevelNodeKindOrderSetting',
			() => {
				return vscode.commands.executeCommand(
					'workbench.action.openSettings',
					'intuita.topLevelNodeKindOrder',
				);
			}
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'intuita.moveTopLevelNode',
			buildMoveTopLevelNodeCommand(
				configurationContainer,
				intuitaFileSystem,
				moveTopLevelNodeJobManager,
			),
		),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(
			async ({ document })=> {
				const { uri } = document;

				if (uri.scheme === 'intuita' && uri.path.startsWith('/jobs/')) {
					await document.save();

					return;
				}

				moveTopLevelNodeJobManager
					.onFileTextChanged(
						document,
					);
			})
		);

	context.subscriptions.push(diagnosticCollection);

	context.subscriptions.push(
		vscode.languages.onDidChangeDiagnostics(
			buildDidChangeDiagnosticsCallback(
				onnxWrapper,
			),
		),
	);
}

export function deactivate() {
	// TODO check if we need to kill the ONNX wrapper process here
}
