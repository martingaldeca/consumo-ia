import {runs, smoothSpans} from '../extension/series.js';

let passed = 0;
function assert(value) {
    if (!value)
        throw new Error('Assertion failed');
}
function test(name, run) {
    run();
    passed++;
    print('✓ ' + name);
}
const now = Date.parse('2026-09-11T14:00:00Z');

test('Los huecos y reinicios separan los tramos observados', () => {
    const groups = runs([
        {time: now, reset: 1}, {time: now + 300000, reset: 1},
        {time: now + 1200001, reset: 1}, {time: now + 1500000, reset: 2},
        {time: now + 1320000, reset: 1},
    ]);
    assert(groups.length === 4 && groups[0].length === 2);
    assert(groups[1][0] === 2 && groups[2][0] === 3 && groups[3][0] === 4);
});
test('Un tramo continuo no se separa aunque haya muchos puntos', () => {
    const points = Array.from({length: 20}, (_value, index) => ({time: now + index * 300000, reset: 7}));
    const groups = runs(points);
    assert(groups.length === 1 && groups[0].length === 20);
});
test('La curva suave no sobrepasa los valores de cada tramo', () => {
    const nodes = [{x: 0, y: 40}, {x: 30, y: 10}, {x: 60, y: 25}, {x: 90, y: 25}, {x: 120, y: 60}];
    const spans = smoothSpans(nodes);
    assert(spans.length === 4);
    for (const [index, span] of spans.entries()) {
        const low = Math.min(nodes[index].y, nodes[index + 1].y);
        const high = Math.max(nodes[index].y, nodes[index + 1].y);
        for (const control of [span.c1, span.c2]) {
            assert(control.y >= low - 0.001 && control.y <= high + 0.001);
            assert(control.x >= nodes[index].x && control.x <= nodes[index + 1].x);
        }
    }
});
test('Los extremos y las mesetas se aplanan sin oscilar', () => {
    const spans = smoothSpans([{x: 0, y: 0}, {x: 10, y: 0}, {x: 20, y: 30}, {x: 30, y: 30}]);
    assert(spans[0].c1.y === 0 && spans[0].c2.y === 0);
    assert(spans[1].c1.y === 0 && spans[1].c2.y === 30 && spans[2].c1.y === 30 && spans[2].c2.y === 30);
});
test('Un único punto o puntos repetidos no generan curvas inválidas', () => {
    assert(smoothSpans([]).length === 0);
    assert(smoothSpans([{x: 4, y: 9}]).length === 0);
    const spans = smoothSpans([{x: 4, y: 9}, {x: 4, y: 20}]);
    assert(spans.length === 1 && Number.isFinite(spans[0].c1.y) && Number.isFinite(spans[0].c2.y));
});
print(passed + ' pruebas de series correctas.');
