import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import Popover from '../../shared/Popover';
import cn from 'classnames';
import s from './style.module.css';

type Props = {
	content: string;
	iconName?: string;
	children?: React.ReactNode;
	onClick(e: React.MouseEvent): void;
};

const ActionButton = ({ content, iconName, children, onClick }: Props) => {
	return (
		<Popover
			children={
				<VSCodeButton
					className={s.action}
					appearance="icon"
					onClick={(e) => {
						e.stopPropagation();
						onClick(e);
					}}
				>
					{iconName ? (
						<i className={cn('codicon', 'mr-2', iconName)} />
					) : null}
					{children}
				</VSCodeButton>
			}
			content={content}
		/>
	);
};

export default ActionButton;
