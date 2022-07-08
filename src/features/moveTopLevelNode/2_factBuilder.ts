import {MoveTopLevelNodeUserCommand} from "./1_userCommandBuilder";
import * as ts from "typescript";
import {buildHash} from "../../utilities";
import {createHash} from "crypto";
import {CharStreams, CommonTokenStream} from "antlr4ts";
import {JavaLexer} from "../../antlrJava/JavaLexer";
import {
    ClassDeclarationContext,
    IdentifierContext,
    JavaParser,
    TypeDeclarationContext
} from "../../antlrJava/JavaParser";
import {AbstractParseTreeVisitor, ParseTree} from "antlr4ts/tree";
import {JavaParserVisitor} from "../../antlrJava/JavaParserVisitor";

export const enum TopLevelNodeKind {
    UNKNOWN = 1,
    CLASS = 2,
    FUNCTION = 3,
    INTERFACE = 4,
    TYPE_ALIAS = 5,
    BLOCK = 6,
    VARIABLE = 7,
    ENUM = 8,
}

const getTopLevelNodeKind = (kind: ts.SyntaxKind): TopLevelNodeKind => {
    switch(kind) {
        case ts.SyntaxKind.ClassDeclaration:
            return TopLevelNodeKind.CLASS;
        case ts.SyntaxKind.FunctionDeclaration:
            return TopLevelNodeKind.FUNCTION;
        case ts.SyntaxKind.InterfaceDeclaration:
            return TopLevelNodeKind.INTERFACE;
        case ts.SyntaxKind.TypeAliasDeclaration:
            return TopLevelNodeKind.TYPE_ALIAS;
        case ts.SyntaxKind.Block:
            return TopLevelNodeKind.BLOCK;
        case ts.SyntaxKind.VariableStatement:
            return TopLevelNodeKind.VARIABLE;
        case ts.SyntaxKind.EnumDeclaration:
            return TopLevelNodeKind.ENUM;
        default:
            return TopLevelNodeKind.UNKNOWN;
    }
};

export type TopLevelNode = Readonly<{
    kind: TopLevelNodeKind,
    id: string,
    start: number,
    end: number,
    identifiers: ReadonlySet<string>,
    childIdentifiers: ReadonlySet<string>,
}>;

export type MoveTopLevelNodeFact = Readonly<{
    topLevelNodes: ReadonlyArray<TopLevelNode>,
    selectedTopLevelNodeIndex: number,
    stringNodes: ReadonlyArray<StringNode>,
}>;

export const getChildIdentifiers = (
    node: ts.Node
): ReadonlyArray<string> => {
    if (ts.isIdentifier(node)) {
        return [ node.text ];
    }

    return node
        .getChildren()
        .map(
            childNode => getChildIdentifiers(childNode)
        )
        .flat();
};

export const getIdentifiers = (
    node: ts.Node,
): ReadonlyArray<string> => {
    if(
        ts.isClassDeclaration(node)
        || ts.isFunctionDeclaration(node)
    ) {
        const text = node.name?.text ?? null;

        if (text === null) {
            return [];
        }

        return [ text ];
    }

    if (
        ts.isInterfaceDeclaration(node)
        || ts.isInterfaceDeclaration(node)
        || ts.isTypeAliasDeclaration(node)
        || ts.isEnumDeclaration(node)
    ) {
        return [ node.name.text ];
    }

    if (ts.isBlock(node)) {
        const hash = createHash('ripemd160')
            .update(
                node.getFullText(),
            )
            .digest('base64url');

        return [
            hash,
        ];
    }

    if (ts.isVariableStatement(node)) {
        return node
            .declarationList
            .declarations
            .map(
                ({ name }) => name
            )
            .filter(ts.isIdentifier)
            .map(({ text }) => text);
    }

    return [];
};

export type StringNode = Readonly<{
    text: string,
    topLevelNodeIndex: number | null,
}>;

export const getStringNodes = (
    fileText: string,
    topLevelNodes: ReadonlyArray<TopLevelNode>
): ReadonlyArray<StringNode> => {
    const stringNodes: Readonly<StringNode>[] = [];

    topLevelNodes.forEach(
        (topLevelNode, index) => {
            if (index === 0) {
                stringNodes.push({
                    text: fileText.slice(0, topLevelNode.start),
                    topLevelNodeIndex: null,
                });
            } else {
                const previousNode = topLevelNodes[index - 1]!;

                stringNodes.push({
                    text: fileText.slice(
                        previousNode.end + 1,
                        topLevelNode.start,
                    ),
                    topLevelNodeIndex: null,
                });
            }

            stringNodes.push({
                text: fileText.slice(topLevelNode.start, topLevelNode.end + 1),
                topLevelNodeIndex: index,
            });

            if (index === (topLevelNodes.length - 1)) {
                stringNodes.push({
                    text: fileText.slice(topLevelNode.end + 1),
                    topLevelNodeIndex: null,
                });
            }
        }
    );

    return stringNodes;
};

const enum FactKind {
    CLASS_DECLARATION = 1,
    TYPE_DECLARATION = 2
}

type Fact =
    | Readonly<{
        kind: FactKind.CLASS_DECLARATION,
        children: ReadonlyArray<Fact>,
    }>
    | Readonly<{
        kind: FactKind.TYPE_DECLARATION,
        topLevelNode: TopLevelNode,
        children: ReadonlyArray<Fact>,
    }>;

export const buildMoveTopLevelNodeFact = (
    userCommand: MoveTopLevelNodeUserCommand
): MoveTopLevelNodeFact => {
    const {
        fileName,
        fileText,
        fileLine,
    } = userCommand;

    const fineLineStart = fileText
        .split('\n')
        .filter((_, index) => index < fileLine)
        .map(({ length }) => length)
        .reduce((a, b) => a + b + 1, 0); // +1 for '\n'

    let topLevelNodes: ReadonlyArray<TopLevelNode> = [];

    if (fileName.endsWith('.ts')) {
        const sourceFile = ts.createSourceFile(
            fileName,
            fileText,
            ts.ScriptTarget.ES5,
            true
        );

        topLevelNodes = sourceFile
            .getChildren()
            .filter(node => node.kind === ts.SyntaxKind.SyntaxList)
            .flatMap((node) => node.getChildren())
            .filter(node => {
                return ts.isClassDeclaration(node)
                    || ts.isFunctionDeclaration(node)
                    || ts.isInterfaceDeclaration(node)
                    || ts.isTypeAliasDeclaration(node)
                    || ts.isBlock(node)
                    || ts.isVariableStatement(node)
                    || ts.isEnumDeclaration(node);
            })
            .map((node) => {
                const kind = getTopLevelNodeKind(node.kind);

                const start = node.getStart();
                const end = start + node.getWidth() - 1;

                const text = fileText.slice(start, end + 1);

                const id = buildHash(text);

                // extract identifiers:
                const identifiers = new Set(getIdentifiers(node));
                const childIdentifiers = new Set(getChildIdentifiers(node));

                identifiers.forEach((identifier) => {
                    childIdentifiers.delete(identifier);
                });

                return {
                    kind,
                    id,
                    start,
                    end,
                    identifiers,
                    childIdentifiers,
                };
            });
    }

    if (fileName.endsWith('.java')) {
        const lines = fileText.split('\n');
        const lengths = lines.map(line => (line.length + 1));

        const inputStream = CharStreams.fromString(fileText);
        const lexer = new JavaLexer(inputStream);
        const tokenStream = new CommonTokenStream(lexer);
        const parser = new JavaParser(tokenStream);

        const parseTree = parser.compilationUnit();

        class Visitor
            extends AbstractParseTreeVisitor<ReadonlyArray<Fact>>
            implements JavaParserVisitor<ReadonlyArray<Fact>>
        {
            defaultResult() {
                return [];
            }

            aggregateResult(aggregate: ReadonlyArray<Fact>, nextResult: ReadonlyArray<Fact>) {
                return aggregate.concat(nextResult);
            }

            visitClassDeclaration(
                ctx: ClassDeclarationContext,
            ): ReadonlyArray<Fact> {
                ctx.text

                const children = this.visitChildren(ctx)

                return [
                    {
                        kind: FactKind.CLASS_DECLARATION,
                        children,
                    },
                ];
            }

            visitTypeDeclaration(
                ctx: TypeDeclarationContext,
            ): ReadonlyArray<Fact> {
                const id = buildHash(ctx.text);

                const startLine = ctx.start.line - 1;
                const startPosition = ctx.start.charPositionInLine;
                const endLine = (ctx.stop?.line ?? ctx.start.line) - 1;
                const endPosition = (ctx.stop?.charPositionInLine ?? ctx.start.charPositionInLine);

                const start = lengths
                    .slice(0, startLine)
                    .reduce((a, b) => a+b, startPosition);

                const end = lengths
                    .slice(0, endLine)
                    .reduce((a, b) => a+b, endPosition);

                const getIdentifiers = (parseTree: ParseTree): ReadonlyArray<string> => {
                    if (parseTree instanceof IdentifierContext) {
                        return [
                            parseTree.text,
                        ];
                    }

                    const { childCount } = parseTree;

                    const identifiers: string[] = [];

                    for(let i = 0; i < childCount; ++i) {
                        identifiers.push(
                            ...getIdentifiers(
                                parseTree.getChild(i)
                            ),
                        );
                    }

                    return identifiers;
                };

                const allIdentifiers = getIdentifiers(ctx);
                const identifiers = allIdentifiers.slice(0, 1);
                const childIdentifiers = allIdentifiers.slice(1);

                const topLevelNode: TopLevelNode = {
                    id,
                    start,
                    end,
                    kind: TopLevelNodeKind.CLASS,
                    identifiers: new Set<string>(identifiers),
                    childIdentifiers: new Set<string>(childIdentifiers),
                };

                const children = this.visitChildren(ctx)

                return [
                    {
                        kind: FactKind.TYPE_DECLARATION,
                        topLevelNode,
                        children,
                    },
                ];
            }
        }

        const visitor = new Visitor();

        topLevelNodes = visitor
            .visit(parseTree)
            .filter((fact): fact is Fact & { kind: FactKind.TYPE_DECLARATION } => fact.kind === FactKind.TYPE_DECLARATION)
            .map((fact) => fact.topLevelNode);

        console.log(topLevelNodes);
    }

    const selectedTopLevelNodeIndex = topLevelNodes
        .findIndex(node => node.start >= fineLineStart);

    const stringNodes = getStringNodes(fileText, topLevelNodes);

    return {
        topLevelNodes,
        selectedTopLevelNodeIndex,
        stringNodes,
    };
};