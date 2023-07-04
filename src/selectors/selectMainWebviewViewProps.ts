import type { Uri } from 'vscode';
import type { RootState } from '../data';
import { selectCodemodRunsTree } from './selectCodemodRunsTree';
import { selectCodemodTree } from './selectCodemodTree';
import { selectExplorerTree } from './selectExplorerTree';
import { CodemodHash } from '../packageJsonAnalyzer/types';

export const selectMainWebviewViewProps = (
	state: RootState,
	rootUri: Uri,
	autocompleteItems: ReadonlyArray<string>,
	executionQueue: ReadonlyArray<CodemodHash>,
) => {
	if (state.activeTabId === 'codemods') {
		return {
			activeTabId: state.activeTabId,
			searchPhrase: state.codemodDiscoveryView.searchPhrase,
			autocompleteItems,
			codemodTree: selectCodemodTree(
				state,
				rootUri.fsPath,
				executionQueue,
			),
			rootPath: rootUri.fsPath,
		};
	}

	if (state.activeTabId === 'codemodRuns') {
		return {
			activeTabId: state.activeTabId,
			applySelectedInProgress: state.applySelectedInProgress,
			codemodRunsTree: selectCodemodRunsTree(state, rootUri.fsPath),
			changeExplorerTree: selectExplorerTree(state),
			panelGroupSettings: state.codemodRunsTab.panelGroupSettings,
			resultsCollapsed: state.codemodRunsTab.resultsCollapsed,
			changeExplorerCollapsed:
				state.codemodRunsTab.changeExplorerCollapsed,
		};
	}

	return {
		activeTabId: state.activeTabId,
	};
};

export type MainWebviewViewProps = ReturnType<
	typeof selectMainWebviewViewProps
>;
