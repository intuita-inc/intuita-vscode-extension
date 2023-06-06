import { useCallback, useEffect, useState } from 'react';
import { vscode } from '../shared/utilities/vscode';
import ListView from './ListView';
import styles from './style.module.css';
import '../shared/util.css';
import type {
	CaseTreeNode,
	View,
	WebviewMessage,
} from '../../../src/components/webview/webviewEvents';

const executeNodeCommands = (node: CaseTreeNode) => {
	node.commands?.forEach((command) => {
		vscode.postMessage({
			kind: 'webview.command',
			value: command,
		});
	});
};

type ViewProps = Extract<View, { viewId: 'campaignManagerView' }>['viewProps'];

function App() {
	const [viewProps, setViewProps] = useState<ViewProps>(
		window.INITIAL_STATE.viewProps as ViewProps,
	);

	const handleItemClick = useCallback((node: CaseTreeNode) => {
		vscode.postMessage({
			kind: 'webview.campaignManager.setSelectedCaseHash',
			caseHash: node.id,
		});

		executeNodeCommands(node);
	}, []);

	useEffect(() => {
		const handler = (e: MessageEvent<WebviewMessage>) => {
			const message = e.data;

			if (message.kind === 'webview.global.setView') {
				// @TODO separate View type to MainViews and SourceControlViews
				if (message.value.viewId === 'campaignManagerView') {
					setViewProps(message.value.viewProps);
				}
			}
		};

		window.addEventListener('message', handler);
		vscode.postMessage({ kind: 'webview.global.afterWebviewMounted' });

		return () => {
			window.removeEventListener('message', handler);
		};
	}, []);

	const { selectedCaseHash, nodes } = viewProps;

	if (selectedCaseHash === null || nodes.length === 0) {
		return (
			<p className={styles.welcomeMessage}>
				No change to review! Run some codemods via Codemod Discovery or
				VS Code Command & check back later!
			</p>
		);
	}

	return (
		<main className="App">
			<ListView
				nodes={nodes}
				selectedCaseHash={selectedCaseHash}
				onItemClick={handleItemClick}
			/>
		</main>
	);
}

export default App;
