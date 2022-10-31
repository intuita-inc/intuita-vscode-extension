import { createPrinter, createSourceFile, EmitHint, factory, JsxSelfClosingElement, NewLineKind, ScriptKind, ScriptTarget } from "typescript";
import type { ReplacementEnvelope } from "../../components/inferenceService";
import type { File } from "../../files/types";
import { buildIntuitaRangeFromSimpleRange } from "../../utilities";

export const buildTs2741NextJsImageNoAltReplacementEnvelope = (
	file: File,
	node: JsxSelfClosingElement,
): ReplacementEnvelope => {
	const sourceFile = createSourceFile(
		'index.ts',
		'',
		ScriptTarget.Latest,
		false,
		ScriptKind.TSX,
	);

	const printer = createPrinter({ newLine: NewLineKind.LineFeed });

	const jsxAttribute = factory.createJsxAttribute(
		factory.createIdentifier('alt'),
		factory.createStringLiteral('', true),
	);

	const { properties } = node.attributes;

	const lastAttribute = properties[properties.length - 1];

	if (!lastAttribute) {
		const jsxSelfClosingElement = factory.updateJsxSelfClosingElement(
			node,
			node.tagName,
			node.typeArguments,
			factory.createJsxAttributes(
				[
					jsxAttribute,
				]
			)
		)
	
		const replacement = printer.printNode(EmitHint.Expression, jsxSelfClosingElement, sourceFile);

		const start = node.getStart();
		const end = node.getEnd();

		const range = buildIntuitaRangeFromSimpleRange(
			file.separator,
			file.lengths,
			{ start, end },
		);

		return {
			range,
			replacement,
		};
	}

	const start = lastAttribute.getEnd();
	const end = start;

	const range = buildIntuitaRangeFromSimpleRange(
		file.separator,
		file.lengths,
		{ start, end },
	);

	const width = lastAttribute.getLeadingTriviaWidth();
	const triviaText = lastAttribute.getFullText().slice(0, width);

	const replacement = printer.printNode(EmitHint.Unspecified, jsxAttribute, sourceFile);

	return {
		range,
		replacement: `${triviaText}${replacement}`,
	};
}
