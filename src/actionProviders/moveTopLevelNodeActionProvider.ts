import * as vscode from 'vscode';
import { buildMoveTopLevelNodeUserCommand } from '../features/moveTopLevelNode/1_userCommandBuilder';
import { buildMoveTopLevelNodeFact } from '../features/moveTopLevelNode/2_factBuilders';
import { Solution } from '../features/moveTopLevelNode/2_factBuilders/solutions';
import {isNeitherNullNorUndefined} from '../utilities';

const buildReason = (
    solution: Solution,
): string | null => {
    const {
        dependencyCoefficient,
        similarityCoefficient,
        kindCoefficient,
    } = solution.coefficient;

    if (dependencyCoefficient > similarityCoefficient && dependencyCoefficient > kindCoefficient) {
        return 'more ordered dependencies';
    }

    if (similarityCoefficient > dependencyCoefficient && similarityCoefficient > kindCoefficient) {
        return 'more name similarity';
    }

    if (kindCoefficient > similarityCoefficient && kindCoefficient > dependencyCoefficient) {
        return 'more same-type blocks';
    }

    return null;
};

const buildIdentifiersLabel = (
    identifiers: ReadonlyArray<string>
): string => {
    return identifiers.length > 1
        ? `(${identifiers.join(' ,')})`
        : identifiers.join('')
}

const buildCodeAction = (
    fileName: string,
    characterDifference: number,
    solution: Solution,
): vscode.CodeAction | null => {
    const { oldIndex, newIndex, nodes } = solution;

    const otherNode = newIndex === 0
        ? nodes[1]
        : nodes[newIndex - 1];

    const node = solution.nodes[newIndex];

    if (!node || !otherNode) {
        return null;
    }

    const orderLabel = newIndex === 0
        ? 'before'
        : 'after';

    const otherIdentifiersLabel = buildIdentifiersLabel(
        Array.from(
            otherNode.identifiers
        )
    );

    const reason = buildReason(solution);
    const reasonBlock = reason !== null ? ` (${reason})` : '';

    const codeAction = new vscode.CodeAction(
        `Move ${orderLabel} ${otherIdentifiersLabel} ${reasonBlock}`,
        vscode.CodeActionKind.Refactor,
    );

    codeAction.command = {
        title: 'Move',
        command: 'intuita.moveTopLevelNode',
        arguments: [
            {
                fileName,
                oldIndex,
                newIndex,
                characterDifference
            }
        ]
    };

    return codeAction;
};

export class MoveTopLevelNodeActionProvider implements vscode.CodeActionProvider<vscode.CodeAction> {
	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
	): Thenable<vscode.CodeAction[]> {
		const fileName = document.fileName;
		const fileText = document.getText();
		const fileLine = range.start.line;
        const fileCharacter = range.start.character;

        const configuration = vscode.workspace.getConfiguration(
            'intuita',
        );

        const dependencyCoefficientWeight = configuration.get<number>('dependencyCoefficientWeight') ?? 1;
        const similarityCoefficientWeight = configuration.get<number>('similarityCoefficientWeight') ?? 1;
        const kindCoefficientWeight = configuration.get<number>('kindCoefficientWeight') ?? 1;

		const userCommand = buildMoveTopLevelNodeUserCommand(
			fileName,
			fileText,
			fileLine,
            fileCharacter,
			{
				dependencyCoefficientWeight,
				similarityCoefficientWeight,
				kindCoefficientWeight,
			},
		);

		const fact = buildMoveTopLevelNodeFact(userCommand);

        const codeActions = fact
            .solutions
            .filter(
                (solution) => {
                    return solution.newIndex !== solution.oldIndex;
                }
            )
            .slice(0, 1)
            .map(
                (solution) => buildCodeAction(
                    fileName,
                    fact.characterDifference,
                    solution,
                )
            )
            .filter(isNeitherNullNorUndefined);

        return Promise.resolve(codeActions);
	}
}
