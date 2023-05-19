import {
	WebviewViewProvider,
	WebviewView,
	Uri,
	ExtensionContext,
	workspace,
	commands,
	ViewColumn,
} from 'vscode';
import { Message, MessageBus, MessageKind } from '../messageBus';
import {
	FileTreeNode,
	TreeNode,
	View,
	WebviewMessage,
	WebviewResponse,
} from './webviewEvents';
import { WebviewResolver } from './WebviewResolver';
import {
	CaseElement,
	Element,
	ElementHash,
	ElementKind,
	FileElement,
} from '../../elements/types';
import { Job, JobHash, JobKind } from '../../jobs/types';
import { getElementIconBaseName } from '../../utilities';
import { JobManager } from '../jobManager';
import { CaseHash, CaseWithJobHashes } from '../../cases/types';
import {
	buildJobElement,
	compareJobElements,
} from '../../elements/buildJobElement';
import {
	buildFileElement,
	compareFileElements,
} from '../../elements/buildFileElement';
import {
	buildCaseElement,
	compareCaseElements,
} from '../../elements/buildCaseElement';
import { CaseManager } from '../../cases/caseManager';
import { DiffWebviewPanel } from './DiffWebviewPanel';

export class FileExplorerProvider implements WebviewViewProvider {
	__view: WebviewView | null = null;
	__extensionPath: Uri;
	__webviewResolver: WebviewResolver | null = null;
	__elementMap = new Map<ElementHash, Element>();
	__folderMap = new Map<string, TreeNode>();
	// map between URIs to the File Tree Node and the job hash
	__fileNodes = new Map<string, { jobHash: JobHash; node: FileTreeNode }>();
	__unsavedChanges = false;
	__lastSelectedCaseHash: CaseHash | null = null;
	__lastSelectedNodeId: string | null = null;

	constructor(
		context: ExtensionContext,
		private readonly __messageBus: MessageBus,
		private readonly __jobManager: JobManager,
		private readonly __caseManager: CaseManager,
	) {
		this.__extensionPath = context.extensionUri;

		this.__webviewResolver = new WebviewResolver(this.__extensionPath);
	}

	refresh(): void {
		if (!this.__view) {
			return;
		}

		this.__webviewResolver?.resolveWebview(
			this.__view.webview,
			'fileExplorer',
			'{}',
		);
	}

	resolveWebviewView(webviewView: WebviewView): void | Thenable<void> {
		if (!webviewView.webview) {
			return;
		}

		this.__webviewResolver?.resolveWebview(
			webviewView.webview,
			'fileExplorer',
			'{}',
		);
		this.__view = webviewView;

		this.__view.onDidChangeVisibility(() => {
			if (this.__lastSelectedCaseHash === null) {
				return;
			}
			// display folders/files for the lastly selected case when panel is collapsed and re-opened
			this.updateExplorerView(this.__lastSelectedCaseHash);
		});

		this.__attachExtensionEventListeners();
		this.__attachWebviewEventListeners();
	}

	public setView(data: View) {
		this.__postMessage({
			kind: 'webview.global.setView',
			value: data,
		});
	}

	public showView() {
		this.__view?.show();
	}

	public setCaseHash(caseHash: CaseHash) {
		this.__lastSelectedCaseHash = caseHash;
	}

	public updateExplorerView(caseHash: CaseHash) {
		if (caseHash === null) {
			return;
		}
		this.__lastSelectedCaseHash = caseHash;
		const rootPath = workspace.workspaceFolders?.[0]?.uri.path ?? '';

		const casesWithJobHashes = this.__caseManager.getCasesWithJobHashes();

		const jobMap = this.__buildJobMap(casesWithJobHashes);

		const [caseElements] = this.__buildCaseElementsAndLatestJob(
			rootPath,
			casesWithJobHashes,
			jobMap,
		);

		if (caseElements.length === 0) {
			return;
		}

		const caseElement = caseElements.find(
			(kase) => kase.hash === (caseHash as unknown as ElementHash),
		);

		if (!caseElement) {
			return;
		}

		this.__folderMap.clear();
		this.__fileNodes.clear();

		const tree = this.__getTreeByDirectory(caseElement);

		if (tree) {
			console.log('SET');
			this.setView({
				viewId: 'treeView',
				viewProps: {
					node: tree,
					nodeIds: Array.from(this.__folderMap.keys()),
					fileNodes: Array.from(this.__fileNodes.values()).map(
						(obj) => obj.node,
					),
					caseHash,
				},
			});
		}
	}

	public focusNode() {
		this.__postMessage({
			kind: 'webview.fileExplorer.focusNode',
			id: this.__lastSelectedNodeId ?? null,
		});
	}

	private __postMessage(message: WebviewMessage) {
		this.__view?.webview.postMessage(message);
	}

	private __getTreeByDirectory = (element: Element): TreeNode | undefined => {
		if (element.kind === ElementKind.CASE) {
			const repoName =
				workspace.workspaceFolders?.[0]?.uri.fsPath
					.split('/')
					.slice(-1)[0] ?? '/';
			this.__folderMap.set(repoName, {
				id: repoName,
				label: repoName,
				kind: 'folderElement',
				iconName: 'folder.svg',
				children: [],
			});
			element.children.forEach(this.__getTreeByDirectory);
			const treeNode = this.__folderMap.get(repoName) ?? undefined;

			return treeNode;
		}

		if (element.kind === ElementKind.FILE) {
			if (element.children.length !== 1) {
				// every file element must have only 1 job child
				return;
			}
			const jobHash = element.children[0]?.jobHash;

			if (!jobHash) {
				return;
			}

			// e.g., extract the path from '/packages/app/src/index.tsx (1)'
			const filePath = element.label.split(' ')[0];
			if (!filePath) {
				return;
			}

			// e.g., ['packages', 'app', 'src', 'index.tsx']
			const directories = filePath
				.split('/')
				.filter((item) => item !== '');
			const fileName = directories[directories.length - 1];
			const repoName =
				workspace.workspaceFolders?.[0]?.uri.fsPath
					.split('/')
					.slice(-1)[0] ?? '/';
			const jobKind = element.children[0]?.job.kind;

			let path = repoName;
			for (const dir of directories) {
				const parentNode = this.__folderMap.get(path) ?? null;

				if (parentNode === null) {
					return;
				}

				path += `/${dir}`;
				if (!this.__folderMap.has(path)) {
					const newTreeNode =
						dir === fileName
							? {
									id: path,
									kind: 'fileElement',
									label: dir,
									iconName: getElementIconBaseName(
										ElementKind.FILE,
										jobKind ?? null,
									),
									children: [],
									jobHash,
							  }
							: {
									id: path,
									kind: 'folderElement',
									label: dir,
									iconName: 'folder.svg',
									children: [],
							  };

					if (dir === fileName) {
						this.__fileNodes.set(path, {
							jobHash,
							node: newTreeNode as FileTreeNode,
						});
					}
					this.__folderMap.set(path, newTreeNode);

					parentNode.children.push(newTreeNode);
				}
			}
		}

		return;
	};

	private __addHook<T extends MessageKind>(
		kind: T,
		handler: (message: Message & { kind: T }) => void,
	) {
		this.__messageBus.subscribe<T>(kind, handler);
	}

	private __buildJobMap(
		casesWithJobHashes: Iterable<CaseWithJobHashes>,
	): ReadonlyMap<JobHash, Job> {
		const map = new Map<JobHash, Job>();

		const jobHashes = Array.from(casesWithJobHashes).flatMap((kase) =>
			Array.from(kase.jobHashes),
		);
		jobHashes.forEach((jobHash) => {
			const job = this.__jobManager.getJob(jobHash);

			if (!job) {
				return;
			}
			map.set(job.hash, job);
		});

		return map;
	}

	__buildCaseElementsAndLatestJob(
		rootPath: string,
		casesWithJobHashes: Iterable<CaseWithJobHashes>,
		jobMap: ReadonlyMap<JobHash, Job>,
	): [ReadonlyArray<CaseElement>, Job | null] {
		let latestJob: Job | null = null;

		const unsortedCaseElements: CaseElement[] = [];

		for (const caseWithJobHashes of casesWithJobHashes) {
			const jobs: Job[] = [];

			for (const jobHash of caseWithJobHashes.jobHashes) {
				const job = jobMap.get(jobHash);

				if (job === undefined) {
					continue;
				}

				jobs.push(job);

				if (latestJob === null || latestJob.createdAt < job.createdAt) {
					latestJob = job;
				}
			}

			const uriSet = new Set<Uri>();

			for (const job of jobs) {
				if (
					[
						JobKind.createFile,
						JobKind.moveFile,
						JobKind.moveAndRewriteFile,
						JobKind.copyFile,
					].includes(job.kind) &&
					job.newUri
				) {
					uriSet.add(job.newUri);
				}

				if (
					[JobKind.rewriteFile, JobKind.deleteFile].includes(
						job.kind,
					) &&
					job.oldUri
				) {
					uriSet.add(job.oldUri);
				}
			}

			const uris = Array.from(uriSet);

			const children = uris.map((uri): FileElement => {
				const label = uri.fsPath.replace(rootPath, '');

				const children = jobs
					.filter(
						(job) =>
							job.newUri?.toString() === uri.toString() ||
							job.oldUri?.toString() === uri.toString(),
					)
					.map((job) => buildJobElement(job, rootPath));

				return buildFileElement(
					caseWithJobHashes.hash,
					label,
					children,
				);
			});

			unsortedCaseElements.push(
				buildCaseElement(caseWithJobHashes, children),
			);
		}

		const sortedCaseElements = unsortedCaseElements
			.sort(compareCaseElements)
			.map((caseElement) => {
				const children = caseElement.children
					.slice()
					.sort(compareFileElements)
					.map((fileElement) => {
						const children = fileElement.children
							.slice()
							.sort(compareJobElements);

						return {
							...fileElement,
							children,
						};
					});

				return {
					...caseElement,
					children,
				};
			});

		return [sortedCaseElements, latestJob];
	}

	private __onClearStateMessage() {
		this.__folderMap.clear();
		this.__fileNodes.clear();
		this.setView({
			viewId: 'treeView',
			viewProps: null,
		});
	}

	private __attachExtensionEventListeners() {
		this.__addHook(MessageKind.clearState, () =>
			this.__onClearStateMessage(),
		);

		this.__addHook(MessageKind.updateElements, () => {
			if (this.__lastSelectedCaseHash === null) {
				return;
			}

			// when "last selected case" was removed, clear the state
			if (
				this.__caseManager.getCase(this.__lastSelectedCaseHash) ===
				undefined
			) {
				this.__onClearStateMessage();
				return;
			}

			// when job elements are updated, refresh the view
			this.updateExplorerView(this.__lastSelectedCaseHash);
		});
	}

	private __onDidReceiveMessage = (message: WebviewResponse) => {
		if (message.kind === 'webview.command') {
			commands.executeCommand(
				message.value.command,
				...(message.value.arguments ?? []),
			);
		}

		if (message.kind === 'webview.fileExplorer.fileSelected') {
			const fileNodeObj = this.__fileNodes.get(message.id) ?? null;
			if (fileNodeObj === null) {
				return;
			}
			this.__lastSelectedNodeId = fileNodeObj.node.id;
			const { jobHash } = fileNodeObj;
			const rootPath =
				workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
			if (rootPath === null) {
				return;
			}
			const panelInstance = DiffWebviewPanel.getInstance(
				{
					type: 'intuitaPanel',
					title: 'Diff',
					extensionUri: this.__extensionPath,
					initialData: {},
					viewColumn: ViewColumn.One,
					webviewName: 'jobDiffView',
				},
				this.__messageBus,
				this.__jobManager,
				this.__caseManager,
				rootPath,
			);

			panelInstance.focusFile(jobHash);
		}

		if (message.kind === 'webview.fileExplorer.folderSelected') {
			const rootPath =
				workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
			if (rootPath === null) {
				return;
			}
			const panelInstance = DiffWebviewPanel.getInstance(
				{
					type: 'intuitaPanel',
					title: 'Diff',
					extensionUri: this.__extensionPath,
					initialData: {},
					viewColumn: ViewColumn.One,
					webviewName: 'jobDiffView',
				},
				this.__messageBus,
				this.__jobManager,
				this.__caseManager,
				rootPath,
			);
			const folderPath = message.id;
			this.__lastSelectedNodeId = folderPath;
			panelInstance.focusFolder(folderPath);
		}

		if (message.kind === 'webview.global.focusView') {
			commands.executeCommand('intuita.focusView', message.webviewName);
		}

		if (message.kind === 'webview.fileExplorer.disposeView') {
			commands.executeCommand('intuita.disposeView', message.webviewName);
		}

		if (message.kind === 'webview.global.discardChanges') {
			commands.executeCommand('intuita.rejectCase', message.caseHash);
		}

		if (message.kind === 'webview.global.applySelected') {
			commands.executeCommand(
				'intuita.sourceControl.saveStagedJobsToTheFileSystem',
				message,
			);
		}

		if (message.kind === 'webview.global.stageJobs') {
			this.__jobManager.setAppliedJobs(message.jobHashes);
			this.__postMessage({
				kind: 'webview.fileExplorer.updateStagedJobs',
				value: message.jobHashes,
			});
		}

		if (message.kind === 'webview.global.afterWebviewMounted') {
			if (this.__lastSelectedCaseHash === null) {
				return;
			}
			this.showView();
			this.updateExplorerView(this.__lastSelectedCaseHash);
		}
	};

	private __attachWebviewEventListeners() {
		this.__view?.webview.onDidReceiveMessage(this.__onDidReceiveMessage);
	}
}
