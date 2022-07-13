import {assert} from "chai";
import { calculateDependencyCoefficient, calculateKindCoefficient, calculateSimilarityCoefficient } from "../../features/moveTopLevelNode/2_factBuilders/coefficients";

import {TopLevelNode, TopLevelNodeKind} from "../../features/moveTopLevelNode/2_factBuilders/topLevelNode";

const buildNode = (
    identifier: string,
    {
        childIdentifiers,
        kind,
    }: Readonly<{
        childIdentifiers?: ReadonlySet<string>,
        kind?: TopLevelNodeKind,
    }>,
): TopLevelNode => {
    return {
        id: identifier,
        kind: kind ?? TopLevelNodeKind.UNKNOWN,
        start: 0,
        end: 10,
        identifiers: new Set([ identifier ]),
        childIdentifiers: childIdentifiers ?? new Set([]),
    };
};

describe('calculateDependencyCoefficient', () => {
    it('should return 0 for 0 nodes', () => {
        const coefficient = calculateDependencyCoefficient([]);

        assert.approximately(coefficient, 0, 0.0001);
    });

    it('should return 0 for 2 nodes (no dependency)', () => {
        const coefficient = calculateDependencyCoefficient([
            buildNode('a', {}),
            buildNode('b', {}),
        ]);

        assert.approximately(coefficient, 0, 0.0001);
    });

    it('should return 0.5 for 2 nodes (one depends on the other)', () => {
        const coefficient = calculateDependencyCoefficient([
            buildNode('a', {
                childIdentifiers: new Set(['b']),
            }),
            buildNode('b', {}),
        ]);

        assert.approximately(coefficient, 0.5, 0.0001);
    });

    it('should return 0 for 2 nodes (one depends on the other)', () => {
        const coefficient = calculateDependencyCoefficient([
            buildNode('a', {}),
            buildNode('b', {
                childIdentifiers: new Set(['a']),
            }),
        ]);

        assert.approximately(coefficient, 0, 0.0001);
    });
});

describe('calculateSimilarityCoefficient', () => {
    it('should return 0 for 0 nodes', () => {
        const coefficient = calculateSimilarityCoefficient(
            [],
            0
        );

        assert.approximately(coefficient, 0, 0.0001);
    });

    it('should return 1 for 3 nodes (no dependency)', () => {
        const coefficient = calculateSimilarityCoefficient(
            [
                buildNode('a', {}),
                buildNode('b', {}),
                buildNode('c', {}),
            ],
            0,
        );

        assert.approximately(coefficient, 1, 0.0001);
    });

    it('should return 0 for 3 nodes (exact names)', () => {
        const coefficient = calculateSimilarityCoefficient(
            [
                buildNode('test', {}),
                buildNode('test', {}),
                buildNode('test', {}),
            ],
            0,
        );

        assert.approximately(coefficient, 0, 0.01);
    });

    it('should return 0.33 for 3 nodes (a half of every word matches)', () => {
        const coefficient = calculateSimilarityCoefficient(
            [
                buildNode('ta', {}),
                buildNode('tb', {}),
                buildNode('tc', {}),
            ],
            0,
        );

        assert.approximately(coefficient, 0.33, 0.01);
    });

    it('should return 0.33 for 3 nodes (80% of every word matches)', () => {
        const coefficient = calculateSimilarityCoefficient(
            [
                buildNode('testa', {}),
                buildNode('testb', {}),
                buildNode('testc', {}),
            ],
            0,
        );

        assert.approximately(coefficient, 0.08, 0.01);
    });

    it('should return 0.55 for 3 nodes (no real matches)', () => {
        const coefficient = calculateSimilarityCoefficient(
            [
                buildNode('function', {}),
                buildNode('class', {}),
                buildNode('method',{}),
            ],
            0,
        );

        assert.approximately(coefficient, 0.55, 0.01);
    });
});

describe('calculateKindCoefficient', () => {
    it('should return 0 for 0 nodes', () => {
        const coefficient = calculateKindCoefficient([], 0);

        assert.approximately(coefficient, 0, 0.0001);
    });

    it('should return 0 for 3 nodes (the same kind)', () => {
        const coefficient = calculateKindCoefficient(
            [
                buildNode('a', { kind: TopLevelNodeKind.CLASS }),
                buildNode('b', { kind: TopLevelNodeKind.CLASS }),
                buildNode('c', { kind: TopLevelNodeKind.CLASS }),
            ],
            0,
        );

        assert.approximately(coefficient, 0, 0.0001);
    });

    it('should return 1 for 3 nodes (different kinds)', () => {
        const coefficient = calculateKindCoefficient(
            [
                buildNode('a', { kind: TopLevelNodeKind.CLASS }),
                buildNode('b', { kind: TopLevelNodeKind.FUNCTION }),
                buildNode('c', { kind: TopLevelNodeKind.INTERFACE }),
            ],
            0,
        );

        assert.approximately(coefficient, 1, 0.0001);
    });
});