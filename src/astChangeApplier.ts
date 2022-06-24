import {Node, Project, SourceFile, SyntaxKind, ts, VariableDeclarationKind} from "ts-morph";
import {AstChange, AstChangeKind} from "./getAstChanges";
import {getClassImportSpecifierFilePaths} from "./tsMorphAdapter/getClassImportSpecifierFilePaths";
import {getClassCommentStatement} from "./tsMorphAdapter/getClassCommentStatement";
import {getClassStaticProperties} from "./tsMorphAdapter/getClassStaticProperties";

class ReadonlyArrayMap<K, I> extends Map<K, ReadonlyArray<I>> {
    public addItem(key: K, item: I): void {
        const items = this.get(key)?.slice() ?? [];

        items.push(item);

        this.set(key, items);
    }
}

export class AstChangeApplier {
    protected _changedSourceFiles = new Set<SourceFile>();

    public constructor(
        protected _project: Project,
        protected readonly _astChanges: ReadonlyArray<AstChange>,
    ) {
    }

    public applyChanges(): ReadonlyArray<[string, string]> {
        this._astChanges.forEach((astChange) => {
            switch(astChange.kind) {
                case AstChangeKind.ARROW_FUNCTION_PARAMETER_DELETED:
                    this._applyArrowFunctionParameterDeletedChange(astChange);
                    return;
                case AstChangeKind.FUNCTION_PARAMETER_DELETED:
                    this._applyFunctionParameterDeletedChange(astChange);
                    return;
                case AstChangeKind.CLASS_METHOD_PARAMETER_DELETED:
                    this._applyClassMethodParameterDeletedChange(astChange);
                    return;
                case AstChangeKind.CLASS_SPLIT_COMMAND:
                    this._applyClassSplitCommandChange(astChange);
            }
        });

        const sourceFiles: [string,string][] = [];

        this._changedSourceFiles.forEach(
            (sourceFile) => {
                sourceFiles.push([
                    sourceFile.getFilePath(),
                    sourceFile.getFullText()
                ]);

                sourceFile.saveSync();
            }
        );

        return sourceFiles;
    }

    protected _applyClassMethodParameterDeletedChange(
        astChange: AstChange & { kind: AstChangeKind.CLASS_METHOD_PARAMETER_DELETED },
    ) {
        const index = astChange.parameters.findIndex(p => p === astChange.parameter);

        if (index === -1) {
            return;
        }

        const sourceFile = this._project.getSourceFile(astChange.filePath)

        if (!sourceFile) {
            return;
        }

        const classDeclaration = sourceFile.getClass(astChange.className);

        if (!classDeclaration) {
            return;
        }

        const methodDeclaration = classDeclaration.getMethod(astChange.methodName);

        if (!methodDeclaration) {
            return;
        }

        methodDeclaration
            .findReferences()
            .flatMap((referencedSymbol) => referencedSymbol.getReferences())
            .forEach(
                (reference) => {
                    const sourceFile = reference.getSourceFile();

                    this._changedSourceFiles.add(sourceFile);

                    const parentNode = reference.getNode().getParent();

                    if (!Node.isPropertyAccessExpression(parentNode)) {
                        return;
                    }

                    const callExpression = parentNode.getParent();

                    if (!Node.isCallExpression(callExpression)) {
                        return;
                    }

                    const argument = callExpression.getArguments()[index];

                    if (!argument) {
                        console.log('no argument')
                        return;
                    }

                    callExpression.removeArgument(argument);
                }
            );
    }

    protected _applyFunctionParameterDeletedChange(
        astChange: AstChange & { kind: AstChangeKind.FUNCTION_PARAMETER_DELETED },
    ) {
        const index = astChange.parameters.findIndex(p => p === astChange.parameter);

        if (index === -1) {
            return;
        }

        const sourceFile = this._project.getSourceFile(astChange.filePath)

        if (!sourceFile) {
            return;
        }

        const functionDeclaration = sourceFile.getFunction(astChange.functionName);

        if (!functionDeclaration) {
            return;
        }

        functionDeclaration
            .findReferences()
            .flatMap((referencedSymbol) => referencedSymbol.getReferences())
            .forEach(
                (reference) => {
                    const sourceFile = reference.getSourceFile();

                    this._changedSourceFiles.add(sourceFile);

                    const parentNode = reference.getNode().getParent();

                    if (!Node.isCallExpression(parentNode)) {
                        return;
                    }

                    const argument = parentNode.getArguments()[index];

                    if (!argument) {
                        return;
                    }

                    parentNode.removeArgument(argument);
                }
            );
    }

    protected _applyArrowFunctionParameterDeletedChange(
        astChange: AstChange & { kind: AstChangeKind.ARROW_FUNCTION_PARAMETER_DELETED },
    ) {
        const index = astChange.parameters.findIndex(p => p === astChange.parameter);

        if (index === -1) {
            return;
        }

        const sourceFile = this._project.getSourceFile(astChange.filePath)

        if (!sourceFile) {
            return;
        }

        const variableDeclaration = sourceFile.getVariableDeclaration(astChange.arrowFunctionName);

        if (!variableDeclaration) {
            return;
        }

        variableDeclaration
            .findReferences()
            .flatMap((referencedSymbol) => referencedSymbol.getReferences())
            .forEach(
                (reference) => {
                    const sourceFile = reference.getSourceFile();

                    this._changedSourceFiles.add(sourceFile);

                    const parentNode = reference.getNode().getParent();

                    if (!Node.isCallExpression(parentNode)) {
                        return;
                    }

                    const argument = parentNode.getArguments()[index];

                    if (!argument) {
                        return;
                    }

                    parentNode.removeArgument(argument);
                }
            );
    }

    protected _applyClassSplitCommandChange(
        astChange: AstChange & { kind: AstChangeKind.CLASS_SPLIT_COMMAND },
    ) {
        const sourceFile = this._project.getSourceFile(astChange.filePath);

        if (!sourceFile) {
            return;
        }

        const classDeclaration = sourceFile
            .getDescendantsOfKind(SyntaxKind.ClassDeclaration)
            .find((cd) => cd.getName() === astChange.className);

        if (!classDeclaration) {
            return;
        }

        const classParentNode = classDeclaration.getParent();

        const members = classDeclaration.getMembers();
        let deletedMemberCount = 0;

        const lazyFunctions: (() => void)[] = [];

        const commentStatement = getClassCommentStatement(classDeclaration);

        const index = classDeclaration.getChildIndex();

        const newImportDeclarationMap = new ReadonlyArrayMap<SourceFile, string>();

        const exported = Node.isSourceFile(classParentNode);

        const staticProperties = getClassStaticProperties(classDeclaration);
        const importSpecifierFilePaths = getClassImportSpecifierFilePaths(classDeclaration);

        staticProperties.forEach(
            (staticProperty) => {
                ++deletedMemberCount;

                lazyFunctions.push(
                    () => staticProperty.staticProperty.remove(),
                );

                if (staticProperty.propertyAccessExpressions.length === 0) {
                    return;
                }

                if(Node.isStatemented(classParentNode)) {
                    const declarationKind = staticProperty.readonly
                        ? VariableDeclarationKind.Const
                        : VariableDeclarationKind.Let;

                    lazyFunctions.push(
                        () => {
                            const variableStatement = classParentNode.insertVariableStatement(
                                index,
                                {
                                    declarationKind,
                                    declarations: [
                                        {
                                            name: staticProperty.name,
                                            initializer: staticProperty.initializer ?? undefined,
                                        }
                                    ],
                                }
                            );

                            variableStatement.setIsExported(exported);
                        }
                    );
                }

                staticProperty.propertyAccessExpressions.forEach(
                    ({ sourceFile, propertyAccessExpression }) => {
                        this._changedSourceFiles.add(sourceFile);
                        lazyFunctions.push(
                            () => {
                                propertyAccessExpression.replaceWithText(staticProperty.name);
                            }
                        );

                        newImportDeclarationMap.addItem(
                            sourceFile,
                            staticProperty.name,
                        );
                    }
                )
            }
        )

        classDeclaration
            .getStaticMethods()
            .forEach(
                (staticMethod) => {
                    const name = staticMethod.getName();

                    const typeParameterDeclarations = staticMethod
                        .getTypeParameters()
                        .map((tpd) => tpd.getStructure());

                    const parameters = staticMethod
                        .getParameters()
                        .map(parameter => parameter.getStructure());

                    const returnType = staticMethod
                        .getReturnTypeNode()
                        ?.getText() ?? 'void';

                    const bodyText = staticMethod.getBodyText();

                    if(Node.isStatemented(classParentNode)) {
                        lazyFunctions.push(
                            () => {
                                const functionDeclaration = classParentNode.insertFunction(
                                    index,
                                    {
                                        name,
                                    }
                                );

                                functionDeclaration.setIsExported(true);
                                functionDeclaration.addTypeParameters(typeParameterDeclarations);
                                functionDeclaration.addParameters(parameters);
                                functionDeclaration.setReturnType(returnType);

                                if (bodyText) {
                                    functionDeclaration.setBodyText(bodyText);
                                }
                            }
                        );
                    }

                    staticMethod
                        .findReferences()
                        .flatMap((referencedSymbol) => referencedSymbol.getReferences())
                        .forEach((referencedSymbolEntry) => {
                            const sourceFile = referencedSymbolEntry.getSourceFile();

                            this._changedSourceFiles.add(sourceFile);

                            const node = referencedSymbolEntry.getNode();

                            const callExpression = node
                                .getFirstAncestorByKind(
                                    ts.SyntaxKind.CallExpression
                                );

                            if (!callExpression) {
                                return;
                            }

                            let typeArguments = callExpression
                                .getTypeArguments()
                                .map(ta => ta.getText())
                                .join(', ');

                            typeArguments = typeArguments ? `<${typeArguments}>` : '';

                            const args = callExpression
                                .getArguments()
                                .map((arg) => arg.getText())
                                .join(', ');

                            // TODO: maybe there's a programmatic way to do this?
                            const text = `${staticMethod.getName()}${typeArguments}(${args})`;

                            lazyFunctions.push(
                                () => callExpression.replaceWithText(text),
                            );

                            newImportDeclarationMap.addItem(
                                sourceFile,
                                name,
                            );
                        });

                    ++deletedMemberCount;

                    lazyFunctions.push(
                        () => staticMethod.remove(),
                    );

                    this._changedSourceFiles.add(sourceFile);
                }
            );

        // CHANGES
        if (commentStatement) {
            commentStatement.remove();
        }

        {
            if (lazyFunctions.length > 0) {
                this._changedSourceFiles.add(sourceFile);
            }

            lazyFunctions.forEach(
                (lazyFunction) => lazyFunction(),
            );
        }

        if (members.length - deletedMemberCount === 0) {
            importSpecifierFilePaths.forEach(
                (filePath) => {
                    const otherSourceFile = this._project.getSourceFile(filePath);

                    if (!otherSourceFile) {
                        return;
                    }

                    otherSourceFile
                        .getImportDeclarations()
                        .filter(
                            (id) => {
                                return id.getModuleSpecifierSourceFile() === sourceFile
                            }
                        )
                        .forEach(
                            (id) => {
                                const namedImports = id.getNamedImports();

                                const namedImport = namedImports
                                    .find(ni => ni.getName()) ?? null;

                                if (!namedImport) {
                                    return;
                                }

                                const count = namedImports.length;

                                // removal
                                namedImport.remove();

                                if (count === 1) {
                                    id.remove();
                                }
                            }
                        );


                }
            )

            newImportDeclarationMap.forEach(
                (names, otherSourceFile) => {
                    if (otherSourceFile === sourceFile) {
                        return;
                    }

                    otherSourceFile.insertImportDeclaration(
                        0,
                        {
                            namedImports: names.slice(),
                            moduleSpecifier: otherSourceFile
                                .getRelativePathAsModuleSpecifierTo(sourceFile.getFilePath()),
                        }
                    );
                }
            )

            classDeclaration.remove();
        }
    }
}
