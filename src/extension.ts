import * as vscode from 'vscode';
import {
	Diagnostic,
	DiagnosticSeverity,
	Position,
	Range,
} from 'vscode';
import {MoveTopLevelNodeActionProvider} from './actionProviders/moveTopLevelNodeActionProvider';
import {getConfiguration} from './configuration';
import {ExtensionStateManager, IntuitaJob} from "./features/moveTopLevelNode/extensionStateManager";
import { assertsNeitherNullOrUndefined } from "./utilities";
import { buildContainer } from "./container";
import { JobHash } from './features/moveTopLevelNode/jobHash';
import { IntuitaFileSystem } from './fileSystems/intuitaFileSystem';
import { MessageBus, MessageKind } from './messageBus';
import { CommandComponent } from './components/commandComponent';
import { buildDidChangeDiagnosticsCallback } from './languages/buildDidChangeDiagnosticsCallback';
import { buildTreeDataProvider } from './treeDataProviders';

export async function activate(
	context: vscode.ExtensionContext,
) {
	const messageBus = new MessageBus(context.subscriptions);

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

	const extensionStateManager = new ExtensionStateManager(
		messageBus,
		configurationContainer,
		_setDiagnosticEntry,
	);

	const treeDataProvider = buildTreeDataProvider(extensionStateManager);

	function _setDiagnosticEntry(
		fileName: string,
		intuitaJobs: ReadonlyArray<IntuitaJob>
	) {
		const diagnostics = intuitaJobs
			.map(
				({ title, range: intuitaRange }) => {
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

					return new Diagnostic(
						range,
						title,
						DiagnosticSeverity.Information
					);
				}
			);

		diagnosticCollection.clear();

		diagnosticCollection.set(
			vscode.Uri.parse(fileName),
			diagnostics,
		);

		treeDataProvider._onDidChangeTreeData.fire();
	};

	messageBus.subscribe(
		(message) => {
			if (message.kind === MessageKind.readingFileFailed) {
				setImmediate(
					() => extensionStateManager.onReadingFileFailed(
						message.uri,
					),
				);
			}  
		},
	);

	const commandComponent = new CommandComponent(
		intuitaFileSystem,
		extensionStateManager,
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
				extensionStateManager,
			)
		));


	const activeTextEditorChangedCallback = (
		document: vscode.TextDocument,
	) => {
		extensionStateManager
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

				extensionStateManager.rejectJob(
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
			async (jobHash, characterDifference) => {
				if (typeof jobHash !== 'string') {
					throw new Error('The job hash argument must be a string.');
				}
					
				if (typeof characterDifference !== 'number') {
					throw new Error('The job hash argument must be a number.');
				}

				const fileName = extensionStateManager.getFileNameFromJobHash(jobHash as JobHash);

				assertsNeitherNullOrUndefined(fileName);

				const result = commandComponent.getJobOutput(jobHash as JobHash);

				assertsNeitherNullOrUndefined(result);

				const textEditors = vscode
					.window
					.visibleTextEditors
					.filter(
						({ document }) => {
							return document.fileName === fileName;
						},
					);

				const textDocuments = vscode
					.workspace
					.textDocuments
					.filter(
						(document) => {
							return document.fileName === fileName;
						},
					);

				const activeTextEditor = vscode.window.activeTextEditor ?? null;

				const range = new vscode.Range(
				    new vscode.Position(
						result.range[0],
						result.range[1],
				    ),
				    new vscode.Position(
						result.range[2],
						result.range[3],
				    ),
				);

				const {
					saveDocumentOnJobAccept,
				} = configurationContainer.get();

				const changeTextEditor = async (textEditor: vscode.TextEditor) => {
					await textEditor.edit(
						(textEditorEdit) => {
							textEditorEdit.replace(
								range,
								result.text,
							);
						}
					);
					
					if (!saveDocumentOnJobAccept) {
						return;
					}

					return textEditor.document.save();
				};

				await Promise.all(
					textEditors.map(
						changeTextEditor,
					)
				);

				if (textEditors.length === 0) {
					textDocuments.forEach(
						(textDocument) => {
							vscode
								.window
								// TODO we can add a range here
								.showTextDocument(textDocument)
								.then(
									changeTextEditor,
								);
						}
					);
				}

				if (activeTextEditor?.document.fileName === fileName) {
					const position = new vscode.Position(
						result.position[0],
						result.position[1],
					);
	
					const selection = new vscode.Selection(
						position,
						position
					);
	
					activeTextEditor.selections = [ selection ];
	
					activeTextEditor.revealRange(
						new vscode.Range(
							position,
							position
						),
						vscode
							.TextEditorRevealType
							.AtTop,
					);
				}

				const allTextDocuments = textEditors
					.map(({ document }) => document)
					.concat(
						textDocuments
					);

				if (allTextDocuments[0]) {
					extensionStateManager
						.onFileTextChanged(
							allTextDocuments[0],
						);
				}
			}
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

				extensionStateManager
					.onFileTextChanged(
						document,
					);
			})
		);

	context.subscriptions.push(diagnosticCollection);

	context.subscriptions.push(
		vscode.languages.onDidChangeDiagnostics(
			buildDidChangeDiagnosticsCallback(
				configurationContainer,
			),
		),
	);
}

// this method is called when your extension is deactivated
export function deactivate() {}
