import { readFileSync } from 'fs';
import { diffTrimmedLines } from 'diff';
import { commands, Uri, ViewColumn, WebviewPanel, window } from 'vscode';
import type { RootState, Store } from '../../data';
import { JobKind, mapPersistedJobToJob } from '../../jobs/types';
import { WebviewResolver } from './WebviewResolver';
import areEqual from 'fast-deep-equal';
import { PanelViewProps } from './panelViewProps';
import { WebviewMessage, WebviewResponse } from './webviewEvents';
import { actions } from '../../data/slice';
import { CodemodDescriptionProvider } from './CodemodDescriptionProvider';
import { selectExplorerTree } from '../../selectors/selectExplorerTree';
import { _ExplorerNode } from '../../persistedState/explorerNodeCodec';
import { MainViewProvider } from './MainProvider';
import { MessageBus, MessageKind } from '../messageBus';
import { JobManager } from '../jobManager';
import {
	createInMemorySourceFile,
	removeLineBreaksAtStartAndEnd,
	removeSpecialCharacters,
} from '../../utilities';
import { encode } from 'universal-base64url';

const TYPE = 'intuitaPanel';
const WEBVIEW_NAME = 'jobDiffView';

const CS_SEARCH_PARAMS_KEYS = Object.freeze({
	ENGINE: 'engine' as const,
	BEFORE_SNIPPET: 'beforeSnippet' as const,
	AFTER_SNIPPET: 'afterSnippet' as const,
	CODEMOD_SOURCE: 'codemodSource' as const,
	CODEMOD_NAME: 'codemodName' as const,
	COMMAND: 'command' as const,
	COMPRESSED_SHAREABLE_CODEMOD: 'c' as const,
});

export const createBeforeAfterSnippets = (
	beforeContent: string,
	afterContent: string,
): { beforeSnippet: string; afterSnippet: string } => {
	const oldSourceFile = createInMemorySourceFile(
		'oldFileContent',
		beforeContent,
	);
	const sourceFile = createInMemorySourceFile('newFileContent', afterContent);

	const beforeNodeTexts = new Set<string>();
	const afterNodeTexts = new Set<string>();

	const diffObjs = diffTrimmedLines(beforeContent, afterContent, {
		newlineIsToken: true,
	});

	for (const diffObj of diffObjs) {
		if (!diffObj.added && !diffObj.removed) {
			continue;
		}
		const codeString = removeLineBreaksAtStartAndEnd(diffObj.value.trim());

		if (removeSpecialCharacters(codeString).length === 0) {
			continue;
		}

		if (diffObj.removed) {
			oldSourceFile.forEachChild((node) => {
				const content = node.getFullText();

				if (
					content.includes(codeString) &&
					!beforeNodeTexts.has(content)
				) {
					beforeNodeTexts.add(content);
				}
			});
		}

		if (diffObj.added) {
			sourceFile.forEachChild((node) => {
				const content = node.getFullText();
				if (
					content.includes(codeString) &&
					!afterNodeTexts.has(content)
				) {
					afterNodeTexts.add(content);
				}
			});
		}
	}

	const irrelevantNodeTexts = new Set<string>();

	beforeNodeTexts.forEach((text) => {
		if (afterNodeTexts.has(text)) {
			irrelevantNodeTexts.add(text);
		}
	});

	irrelevantNodeTexts.forEach((text) => {
		beforeNodeTexts.delete(text);
		afterNodeTexts.delete(text);
	});

	const beforeSnippet = removeLineBreaksAtStartAndEnd(
		Array.from(beforeNodeTexts).join(''),
	);

	const afterSnippet = removeLineBreaksAtStartAndEnd(
		Array.from(afterNodeTexts).join(''),
	);
	return { beforeSnippet, afterSnippet };
};

const selectPanelViewProps = (
	mainWebviewViewProvider: MainViewProvider,
	codemodDescriptionProvider: CodemodDescriptionProvider,
	state: RootState,
	rootPath: string | null,
): PanelViewProps | null => {
	if (!state.jobDiffView.visible) {
		return null;
	}

	if (!mainWebviewViewProvider.isVisible()) {
		return null;
	}

	const { activeTabId } = state;

	if (activeTabId === 'codemods') {
		const { focusedCodemodHashDigest } = state.codemodDiscoveryView;

		if (focusedCodemodHashDigest === null) {
			return null;
		}

		const codemod =
			state.codemod.entities[focusedCodemodHashDigest] ??
			state.privateCodemods.entities[focusedCodemodHashDigest] ??
			null;

		if (codemod === null) {
			return null;
		}

		const description = codemodDescriptionProvider.getCodemodDescription(
			codemod.name,
		);

		return {
			kind: 'CODEMOD',
			title: codemod.name,
			description: description,
		};
	}

	if (rootPath === null || activeTabId === 'community') {
		return null;
	}

	const { selectedCaseHash } = state.codemodRunsTab;

	if (selectedCaseHash === null) {
		return null;
	}

	const focusedExplorerNodeHashDigest =
		state.focusedExplorerNodes[selectedCaseHash] ?? null;

	if (focusedExplorerNodeHashDigest === null) {
		return null;
	}

	const tree = selectExplorerTree(state, rootPath);

	if (tree === null) {
		return null;
	}

	const { nodeData } = tree;

	const jobNodes = nodeData
		.map(({ node }) => node)
		.filter(
			(node): node is _ExplorerNode & { kind: 'FILE' } =>
				node.kind === 'FILE',
		);

	const jobIndex = jobNodes.findIndex(
		({ hashDigest }) => hashDigest === focusedExplorerNodeHashDigest,
	);

	const persistedJob =
		state.job.entities[jobNodes[jobIndex]?.jobHash ?? -1] ?? null;

	if (persistedJob === null) {
		return null;
	}

	const job = mapPersistedJobToJob(persistedJob);

	const newFileTitle = job.newUri?.fsPath.replace(rootPath, '') ?? null;
	const oldFileTitle =
		[
			JobKind.moveFile,
			JobKind.moveAndRewriteFile,
			JobKind.copyFile,
		].includes(job.kind) && job.oldUri
			? job.oldUri.fsPath.replace(rootPath, '')
			: null;

	const newFileContent =
		job.newContentUri !== null
			? readFileSync(job.newContentUri.fsPath).toString('utf8')
			: null;

	const oldFileContent =
		job.oldUri !== null &&
		[
			JobKind.rewriteFile,
			JobKind.deleteFile,
			JobKind.moveAndRewriteFile,
			JobKind.moveFile,
		].includes(job.kind)
			? readFileSync(job.oldUri.fsPath).toString('utf8')
			: null;

	const reviewed = (
		state.reviewedExplorerNodes[selectedCaseHash] ?? []
	).includes(focusedExplorerNodeHashDigest);

	return {
		kind: 'JOB',
		title: newFileTitle ?? oldFileTitle ?? '',
		caseHash: selectedCaseHash,
		jobHash: job.hash,
		jobKind: job.kind,
		modifiedByUser: job.modifiedByUser,
		oldFileTitle,
		newFileTitle,
		oldFileContent,
		newFileContent,
		reviewed,
	};
};

export class IntuitaPanelProvider {
	private __webviewPanel: WebviewPanel | null = null;

	public constructor(
		private readonly __extensionUri: Uri,
		private readonly __store: Store,
		private readonly __mainWebviewViewProvider: MainViewProvider,
		messageBus: MessageBus,
		private readonly __codemodDescriptionProvider: CodemodDescriptionProvider,
		private readonly __rootPath: string | null,
		private readonly __jobManager: JobManager,
	) {
		let prevViewProps = selectPanelViewProps(
			__mainWebviewViewProvider,
			__codemodDescriptionProvider,
			__store.getState(),
			__rootPath,
		);

		const listener = async () => {
			const nextViewProps = selectPanelViewProps(
				__mainWebviewViewProvider,
				__codemodDescriptionProvider,
				__store.getState(),
				__rootPath,
			);

			if (areEqual(prevViewProps, nextViewProps)) {
				return;
			}

			prevViewProps = nextViewProps;

			if (nextViewProps !== null) {
				await this.__upsertPanel(nextViewProps, true);
			} else {
				this.__disposePanel();
			}
		};

		__store.subscribe(listener);

		__codemodDescriptionProvider.onDidChange(listener);
		messageBus.subscribe(
			MessageKind.mainWebviewViewVisibilityChange,
			listener,
		);
	}

	private async __upsertPanel(
		panelViewProps: PanelViewProps,
		preserveFocus: boolean,
	) {
		if (this.__webviewPanel === null) {
			const webviewResolver = new WebviewResolver(this.__extensionUri);
			this.__webviewPanel = window.createWebviewPanel(
				TYPE,
				panelViewProps.title,
				{
					viewColumn: ViewColumn.One,
					preserveFocus,
				},
				webviewResolver.getWebviewOptions(),
			);

			webviewResolver.resolveWebview(
				this.__webviewPanel.webview,
				WEBVIEW_NAME,
				JSON.stringify(panelViewProps),
				'panelViewProps',
			);

			this.__webviewPanel.webview.onDidReceiveMessage(
				async (message: WebviewResponse) => {
					if (
						message.kind === 'webview.panel.focusOnChangeExplorer'
					) {
						this.__store.dispatch(actions.focusOnChangeExplorer());

						commands.executeCommand('intuitaMainView.focus');
					}

					if (
						message.kind ===
						'webview.global.focusExplorerNodeSibling'
					) {
						this.__store.dispatch(
							actions.focusExplorerNodeSibling([
								message.caseHashDigest,
								message.direction,
							]),
						);
					}

					if (message.kind === 'webview.global.openIssueCreation') {
						const state = this.__store.getState();

						const job =
							state.job.entities[message.faultyJobHash] ?? null;

						if (job === null) {
							throw new Error('Unable to get the job');
						}

						this.__store.dispatch(
							actions.setSourceControlViewProps({
								kind: 'ISSUE_CREATION',
								jobHash: message.faultyJobHash,
								oldFileContent: message.oldFileContent,
								newFileContent: message.newFileContent,
							}),
						);
					}

					if (
						message.kind === 'webview.global.exportToCodemodStudio'
					) {
						const state = this.__store.getState();

						const job =
							state.job.entities[message.faultyJobHash] ?? null;

						if (job === null) {
							throw new Error('Unable to get the job');
						}

						const { beforeSnippet, afterSnippet } =
							createBeforeAfterSnippets(
								message.oldFileContent,
								message.newFileContent,
							);

						const searchParams = new URLSearchParams();

						searchParams.set(
							CS_SEARCH_PARAMS_KEYS.BEFORE_SNIPPET,
							encode(beforeSnippet),
						);
						searchParams.set(
							CS_SEARCH_PARAMS_KEYS.AFTER_SNIPPET,
							encode(afterSnippet),
						);
						searchParams.set(
							CS_SEARCH_PARAMS_KEYS.CODEMOD_NAME,
							encode(job.codemodName),
						);
						// searchParams.set(
						// 	CS_SEARCH_PARAMS_KEYS.CODEMOD_SOURCE,
						// 	encode(internalContent ?? ''),
						// );

						const url = new URL('https://codemod.studio');
						url.search = searchParams.toString();

						commands.executeCommand('intuita.redirect', url);
					}

					if (
						message.kind ===
						'webview.global.flipReviewedExplorerNode'
					) {
						this.__store.dispatch(
							actions.flipReviewedExplorerNode([
								message.caseHashDigest,
								message.jobHash,
								message.path,
							]),
						);
					}

					if (
						message.kind === 'webview.global.showInformationMessage'
					) {
						window.showInformationMessage(message.value);
					}

					if (message.kind === 'webview.jobDiffView.webviewMounted') {
						const nextViewProps = selectPanelViewProps(
							this.__mainWebviewViewProvider,
							this.__codemodDescriptionProvider,
							this.__store.getState(),
							this.__rootPath,
						);

						if (
							nextViewProps === null ||
							this.__webviewPanel === null
						) {
							return;
						}

						this.__webviewPanel.webview.postMessage({
							kind: 'webview.setPanelViewProps',
							panelViewProps: nextViewProps,
						} satisfies WebviewMessage);

						this.__webviewPanel.reveal(undefined, preserveFocus);
					}

					if (message.kind === 'webview.panel.contentModified') {
						if (this.__webviewPanel === null) {
							return;
						}

						await this.__jobManager.changeJobContent(
							message.jobHash,
							message.newContent,
						);

						const nextViewProps = selectPanelViewProps(
							this.__mainWebviewViewProvider,
							this.__codemodDescriptionProvider,
							this.__store.getState(),
							this.__rootPath,
						);

						this.__webviewPanel.webview.postMessage({
							kind: 'webview.main.setProps',
							props: nextViewProps,
						});
					}
				},
			);

			this.__webviewPanel.onDidDispose(() => {
				this.__webviewPanel = null;
				this.__store.dispatch(actions.setJobDiffViewVisible(false));
			});

			return;
		}

		this.__webviewPanel.title = panelViewProps.title;
		await this.__webviewPanel.webview.postMessage({
			kind: 'webview.setPanelViewProps',
			panelViewProps,
		} satisfies WebviewMessage);
		this.__webviewPanel.reveal(undefined, preserveFocus);
	}

	private __disposePanel() {
		this.__webviewPanel?.dispose();

		this.__webviewPanel = null;
	}
}
