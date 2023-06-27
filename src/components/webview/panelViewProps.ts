import type { CaseHash } from '../../cases/types';
import type { JobKind } from '../../jobs/types';
import type { JobHash } from './webviewEvents';

export type PanelViewProps =
	| Readonly<{
			kind: 'JOB';
			title: string;
			caseHash: CaseHash;
			jobHash: JobHash;
			jobKind: JobKind;
			oldFileContent: string | null;
			newFileContent: string | null;
			oldFileTitle: string | null;
			newFileTitle: string | null;
	  }>
	| Readonly<{
			kind: 'CODEMOD';
			title: string;
			description: string;
	  }>;
