import type {ClassDeclaration, Scope} from "ts-morph"
import {Node} from "ts-morph";
import {buildNodeLookupCriterion, NodeLookupCriterion} from "./nodeLookup";
import {isNeitherNullNorUndefined} from "../utilities";

export type ConstructorReference = Readonly<{
    nodeLookupCriterion: NodeLookupCriterion,
    arguments: ReadonlyArray<string>,
}>;

type Constructor = Readonly<{
    bodyText: string | null,
    typeParameters: ReadonlyArray<string>,
    parameters: ReadonlyArray<
        Readonly<{
            name: string,
            initializer: string | null,
            type: string | null,
            readonly: boolean,
            scope: Scope | null,
        }>
    >
    references: ReadonlyArray<ConstructorReference>,
}>;

export const getClassConstructors = (
    classDeclaration: ClassDeclaration
): ReadonlyArray<Constructor> => {
    return classDeclaration
        .getConstructors()
        .map((constructorDeclaration) => {
            const bodyText = constructorDeclaration.getBodyText() ?? null;

            const typeParameters = constructorDeclaration
                .getTypeParameters()
                .map(typeParameter => typeParameter.getText());

            const parameters = constructorDeclaration
                .getParameters()
                .map((parameterDeclaration) => parameterDeclaration.getStructure())
                .map(structure => ({
                    name: structure.name,
                    initializer: typeof structure.initializer === 'string'
                        ? structure.initializer
                        : null,
                    type: typeof structure.type === 'string'
                        ? structure.type
                        : null,
                    readonly: structure.isReadonly ?? false,
                    scope: structure.scope ?? null,
                }));

            const references = constructorDeclaration
                .findReferences()
                .flatMap((referencedSymbol) => referencedSymbol.getReferences())
                .map(
                    (referencedSymbolEntry) => {
                        const node = referencedSymbolEntry.getNode();
                        const parentNode = node.getParent();

                        if (Node.isNewExpression(parentNode)) {
                            const _arguments = parentNode
                                .getArguments()
                                .map((node) => node.getText());

                            const nodeLookupCriterion = buildNodeLookupCriterion(
                                parentNode.getSourceFile(),
                                parentNode.compilerNode,
                                1,
                            );

                            const reference: ConstructorReference = {
                                nodeLookupCriterion,
                                arguments: _arguments,
                            };

                            return reference;
                        }

                        return null;
                    }
                )
                .filter(isNeitherNullNorUndefined);


            return {
                bodyText,
                typeParameters,
                parameters,
                references,
            };
        });
};