import {ClassDeclaration, Node, StructureKind, ts} from "ts-morph";
import {isNeitherNullNorUndefined} from "../utilities";
import {ClassInstanceProperty, ClassInstancePropertyKind} from "../intuitaExtension/classInstanceProperty";

export const getClassInstanceProperties = (
    classDefinition: ClassDeclaration
): ReadonlyArray<ClassInstanceProperty> => {
    return classDefinition
        .getInstanceProperties()
        .map(
            (instanceProperty) => {
                if (Node.isParameterDeclaration(instanceProperty) || Node.isPropertyDeclaration(instanceProperty)) {
                    console.log(instanceProperty.getKindName())

                    const name = instanceProperty.getName();
                    const readonly = Boolean(
                        instanceProperty.getCombinedModifierFlags() & ts.ModifierFlags.Readonly
                    );

                    const structure = instanceProperty.getStructure();

                    const initializer =
                        structure.kind === StructureKind.Property
                            ? structure.initializer?.toString() ?? null
                            : null;

                    const body = instanceProperty.getText();

                    const methodNames = instanceProperty
                        .findReferences()
                        .flatMap((referencedSymbol) => referencedSymbol.getReferences())
                        .map(
                            (referencedSymbolEntry) => {
                                return referencedSymbolEntry
                                    .getNode()
                                    .getFirstAncestorByKind(ts.SyntaxKind.MethodDeclaration)
                            }
                        )
                        .filter(isNeitherNullNorUndefined)
                        .map(
                            (methodDeclaration) => {
                                const methodName = methodDeclaration.getName();

                                const methodClassDeclaration = methodDeclaration
                                    .getFirstAncestorByKind(ts.SyntaxKind.ClassDeclaration)

                                if (methodClassDeclaration !== classDefinition) {
                                    return null;
                                }

                                return methodName;
                            }
                        )
                        .filter(isNeitherNullNorUndefined)
                    ;

                    return <ClassInstanceProperty>{
                        kind: ClassInstancePropertyKind.PROPERTY,
                        name,
                        readonly,
                        initializer,
                        methodNames,
                    };
                }

                // if (Node.isGetAccessorDeclaration(instanceProperty)) {
                //     instanceProperty.getBodyText()
                // }

                return null;
            }
        )
        .filter(isNeitherNullNorUndefined);
}