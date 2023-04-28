import { useEffect, useState } from 'react';
import cn from 'classnames';
import { vscode } from '../shared/utilities/vscode';
import type { View, WebviewMessage, CodemodTreeNode } from '../shared/types';
import TreeView from './TreeView';
import { Container, LoadingContainer } from './components/Container';
import { VSCodeProgressRing } from '@vscode/webview-ui-toolkit/react';
import * as E from 'fp-ts/Either';
import './index.css';
import { BuildItYourSelf } from './BuildItYourSelf';

type MainViews = Extract<View, { viewId: 'codemodList' }>;

function App() {
	const [view, setView] = useState<MainViews | null>(null);

	const [publicCodemods, setPublicCodemods] = useState<
		E.Either<Error, CodemodTreeNode<string> | null>
	>(E.right(null));

	const [pathEditResponse, setPathEditResponse] = useState<
		E.Either<Error, string | null>
	>(E.right(null));

	const [publicCodemodsExpanded, setPublicCodemodsExpanded] = useState(true);
	const [recommendedCodemodsExpanded, seRecommendedCodemodsExpanded] =
		useState(true);
	useEffect(() => {
		vscode.postMessage({ kind: 'webview.global.afterWebviewMounted' });
	}, []);

	useEffect(() => {
		const handler = (e: MessageEvent<WebviewMessage>) => {
			const message = e.data;
			if (
				message.kind === 'webview.global.setView' &&
				message.value.viewId === 'codemodList'
			) {
				setView(message.value);
			}
			if (message.kind === 'webview.codemods.setPublicCodemods') {
				setPublicCodemods(message.data);
			}
			if (message.kind === 'webview.codemodList.updatePathResponse') {
				setPathEditResponse(message.data);
			}
		};

		window.addEventListener('message', handler);

		return () => {
			window.removeEventListener('message', handler);
		};
	}, []);

	if (!view) {
		return null;
	}

	return (
		<main className="App">
			<Container
				defaultExpanded={false}
				className={cn('flex-none d-none', {
					'max-h-full h-full-40':
						!publicCodemodsExpanded && recommendedCodemodsExpanded,
					'max-h-half h-auto': publicCodemodsExpanded,
				})}
				onToggle={(toggled) => seRecommendedCodemodsExpanded(toggled)}
				headerTitle="Recommended Codemods"
			>
				<TreeView
					response={pathEditResponse}
					node={view.viewProps.data}
				/>
			</Container>
			<Container
				defaultExpanded
				onToggle={(toggled) => setPublicCodemodsExpanded(toggled)}
				headerTitle="Public Codemods"
				className=" content-border-top  h-full"
			>
				<div>
					{E.isRight(publicCodemods) &&
						publicCodemods.right !== null && (
							<TreeView
								response={pathEditResponse}
								node={publicCodemods.right}
							/>
						)}
					{E.isRight(publicCodemods) &&
						publicCodemods.right === null && (
							<LoadingContainer>
								<VSCodeProgressRing className="progressBar" />
								<span aria-label="loading">Loading ...</span>
							</LoadingContainer>
						)}
					{E.isLeft(publicCodemods) && (
						<p>{publicCodemods.left.message}</p>
					)}
				</div>
			</Container>
			<Container
				defaultExpanded={false}
				headerTitle="Build It Yourself"
				className=" content-border-top  h-full"
			>
				<BuildItYourSelf />
			</Container>
		</main>
	);
}

export default App;
