import {normalizeActivity, paceColor, periodStart, tokenPeriod} from '../extension/model.js';

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
const window = delta => ({remaining: 50 + delta, windowMinutes: 10080, resetsAt: now + 3.5 * 86400000});
test('La barra interpola rojo, ámbar y verde en los umbrales del ritmo', () => {
    assert(paceColor(window(-8), now).join() === '251,113,133');
    assert(paceColor(window(0), now).join() === '251,191,36');
    assert(paceColor(window(9), now).join() === '74,222,128');
    assert(paceColor(window(2.5), now).join() === '163,207,82');
});
test('Cuota agotada roja y fecha no disponible cian', () => {
    assert(paceColor({...window(0), remaining: 0}, now).join() === '251,113,133');
    assert(paceColor({...window(0), resetsAt: null}, now).join() === '91,220,250');
});
test('Las estadísticas descartan valores inválidos y no duplican días', () => {
    const data = normalizeActivity({summary: {lifetimeTokens: 1200, peakDailyTokens: null}, dailyUsageBuckets: [
        {startDate: '2026-09-11', tokens: 0},
        {startDate: '2026-09-10', tokens: 30},
        {startDate: '2026-09-10', tokens: 40},
        {startDate: '2026-02-30', tokens: 99},
        {startDate: '2026-09-09', tokens: -1},
    ], threadUsage: {private: 'ignored'}});
    assert(data.daily.length === 2 && data.daily[0].tokens === 40);
    assert(data.summary.lifetimeTokens === 1200 && data.summary.peakDailyTokens === null);
    assert(!Object.hasOwn(data, 'threadUsage'));
});
test('Distingue un cero publicado de un período sin datos', () => {
    const data = normalizeActivity({dailyUsageBuckets: [{startDate: '2026-09-11', tokens: 0}]});
    assert(tokenPeriod(data, 1, now).total === 0);
    assert(tokenPeriod(data, 1, now - 86400000).total === null);
    assert(tokenPeriod(data, 7, now).observedDays === 1);
});
test('Los períodos usan días UTC y excluyen datos fuera del intervalo', () => {
    assert(periodStart(7, now) === Date.parse('2026-09-05T00:00:00Z'));
    const data = normalizeActivity({dailyUsageBuckets: [
        {startDate: '2026-09-04', tokens: 1000},
        {startDate: '2026-09-05', tokens: 5},
        {startDate: '2026-09-11', tokens: 11},
        {startDate: '2026-09-12', tokens: 1000},
    ]});
    assert(tokenPeriod(data, 7, now).total === 16);
});
print(passed + ' pruebas de actividad correctas.');
