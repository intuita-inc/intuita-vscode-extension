import { Header } from './Container';
import { Collapsable } from '../Components/Collapsable';
import { Diff, DiffComponent } from './Diff';
import { reportIssue } from '../util';
import { KeyboardEvent, forwardRef, memo, useCallback } from 'react';
import './DiffItem.css';
import { vscode } from '../../shared/utilities/vscode';
import { JobDiffViewProps } from '../../shared/types';
import debounce from '../../shared/utilities/debounce';

type Props = JobDiffViewProps & {
	viewType: 'inline' | 'side-by-side';
	diff: Diff | null;
	onDiffCalculated: (diff: Diff) => void;
	theme: string;
	title: string;
};

export const JobDiffView = memo(
	forwardRef<HTMLDivElement, Props>(
		(
			{
				viewType,
				jobHash,
				jobKind,
				oldFileContent,
				newFileContent,
				oldFileTitle,
				title,
				onDiffCalculated,
				diff,
				theme,
			}: Props,
			ref,
		) => {
			const report = useCallback(() => {
				reportIssue(
					jobHash,
					oldFileContent ?? '',
					newFileContent ?? '',
				);
			}, [jobHash, oldFileContent, newFileContent]);

			const handleDiffCalculated = useCallback(
				(diff: Diff) => {
					onDiffCalculated(diff);
				},
				[onDiffCalculated],
			);

			const handleContentChange = debounce((newContent: string) => {
				vscode.postMessage({
					kind: 'webview.jobDiffView.contentModified',
					newContent,
					jobHash,
				});
			}, 1000);

			return (
				<div
					ref={ref}
					className="px-5 pb-2-5 diff-view-container h-full"
					tabIndex={0}
					onKeyDown={(event: KeyboardEvent) => {
						if (event.key === 'ArrowLeft') {
							event.preventDefault();

							vscode.postMessage({
								kind: 'webview.panel.focusOnChangeExplorer',
							});
						}
					}}
				>
					<Collapsable
						defaultExpanded={true}
						className="overflow-hidden rounded h-full"
						headerClassName="p-10"
						contentClassName="p-10 h-full"
						headerSticky
						headerComponent={
							<Header
								id={`diffViewHeader-${jobHash}`}
								diff={diff}
								oldFileTitle={oldFileTitle ?? ''}
								jobKind={jobKind}
								title={title ?? ''}
								onReportIssue={report}
							/>
						}
					>
						<DiffComponent
							theme={theme}
							viewType={viewType}
							oldFileContent={oldFileContent}
							newFileContent={newFileContent}
							onDiffCalculated={handleDiffCalculated}
							onChange={handleContentChange}
							jobHash={jobHash}
						/>
					</Collapsable>
				</div>
			);
		},
	),
);
