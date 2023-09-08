import { useEffect, useRef, useState } from 'react';

import {
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
} from '@vscode/webview-ui-toolkit/react';

import { App as CodemodList } from '../codemodList/App';
import { CommunityTab } from '../communityTab/CommunityTab';
import { CodemodRuns } from './CodemodRuns';
import { WebviewMessage } from '../shared/types';
import { vscode } from '../shared/utilities/vscode';
import { ActiveTabId } from '../../../src/persistedState/codecs';
import type { MainWebviewViewProps } from '../../../src/selectors/selectMainWebviewViewProps';
import CreateIssue from '../CreateIssue';

declare global {
	interface Window {
		mainWebviewViewProps: MainWebviewViewProps;
	}
}

function App() {
	const ref = useRef(null);
	const [screenWidth, setScreenWidth] = useState<number | null>(null);
	const [mainWebviewViewProps, setMainWebviewViewProps] = useState(
		window.mainWebviewViewProps,
	);

	useEffect(() => {
		const handler = (event: MessageEvent<WebviewMessage>) => {
			if (event.data.kind !== 'webview.main.setProps') {
				return;
			}

			setMainWebviewViewProps(event.data.props);
		};

		window.addEventListener('message', handler);

		return () => {
			window.removeEventListener('message', handler);
		};
	}, []);

	useEffect(() => {
		if (ResizeObserver === undefined) {
			return undefined;
		}

		if (ref.current === null) {
			return;
		}

		const resizeObserver = new ResizeObserver((entries) => {
			const container = entries[0] ?? null;
			if (container === null) {
				return;
			}
			const {
				contentRect: { width },
			} = container;

			setScreenWidth(width);
		});

		resizeObserver.observe(ref.current);

		return () => {
			resizeObserver.disconnect();
		};
	}, []);

	const handlePanelTabClick = (id: ActiveTabId) => {
		vscode.postMessage({
			kind: 'webview.main.setActiveTabId',
			activeTabId: id,
		});
	};

	return (
		<main className="App" ref={ref}>
			<VSCodePanels
				activeid={mainWebviewViewProps.activeTabId}
				onChange={(e) => {
					const newValue =
						(e as unknown as { detail: HTMLElement | null }).detail
							?.id ?? null;

					if (newValue === null) {
						return;
					}

					if (newValue !== mainWebviewViewProps.activeTabId) {
						handlePanelTabClick(newValue as ActiveTabId);
					}
				}}
				className="h-full w-full vscode-panels"
			>
				<VSCodePanelTab className="vscode-tab" id={'codemods'}>
					Codemod Discovery
				</VSCodePanelTab>
				<VSCodePanelTab className="vscode-tab" id={'codemodRuns'}>
					Codemod Runs
				</VSCodePanelTab>
				<VSCodePanelTab className="vscode-tab" id={'community'}>
					Community
				</VSCodePanelTab>
				<VSCodePanelTab className="vscode-tab" id={'sourceControl'}>
					Github Issue
				</VSCodePanelTab>

				<VSCodePanelView
					className="vscode-panel-view h-full w-full"
					id="codemodsView"
				>
					{mainWebviewViewProps.activeTabId === 'codemods' ? (
						<CodemodList
							screenWidth={screenWidth}
							{...mainWebviewViewProps}
						/>
					) : null}
				</VSCodePanelView>
				<VSCodePanelView
					className="vscode-panel-view h-full w-full"
					id="codemodRunsView"
				>
					{mainWebviewViewProps.activeTabId === 'codemodRuns' ? (
						<CodemodRuns
							screenWidth={screenWidth}
							{...mainWebviewViewProps}
						/>
					) : null}
				</VSCodePanelView>
				<VSCodePanelView
					className="vscode-panel-view h-full w-full"
					id="communityView"
				>
					{mainWebviewViewProps.activeTabId === 'community' ? (
						<CommunityTab />
					) : null}
				</VSCodePanelView>
				<VSCodePanelView
					className="vscode-panel-view h-full w-full"
					id="createIssueView"
				>
					{mainWebviewViewProps.activeTabId === 'sourceControl' ? (
						mainWebviewViewProps.title !== null &&
						mainWebviewViewProps.body !== null ? (
							<CreateIssue
								title={mainWebviewViewProps.title}
								body={mainWebviewViewProps.body}
							/>
						) : (
							<p>No issue in progress</p>
						)
					) : null}
				</VSCodePanelView>
			</VSCodePanels>
		</main>
	);
}

export default App;
