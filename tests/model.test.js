import {normalizeCodex, normalizeDeepSeek, indicatorWindow, weeklyWindow, pace, countdown, money, UsageError} from '../extension/model.js';

let passed = 0;
function test(name, run) {
    run();
    passed++;
    print('✓ ' + name);
}
function assert(value) {
    if (!value)
        throw new Error('Assertion failed');
}
function rejects(run) {
    try {
        run();
    } catch (error) {
        assert(error instanceof UsageError);
        return;
    }
    throw new Error('Expected UsageError');
}
const now = Date.parse('2026-09-10T12:00:00Z');
const window = {usedPercent: 12, windowMinutes: 10080, resetsAt: new Date(now + 3.5 * 86400000).toISOString()};
const codex = usage => normalizeCodex([{provider: 'codex', usage}]);
const balance = (total = '12.34', currency = 'USD') => ({currency, total_balance: total, topped_up_balance: total, granted_balance: '0.00'});

test('La ventana principal ausente no se convierte en cuota cero', () => {
    const data = codex({primary: null, secondary: window});
    assert(data.windows.length === 1 && data.windows[0].remaining === 88);
    assert(indicatorWindow(data).id === 'secondary');
});
test('Las ventanas Spark no se muestran ni sustituyen la semanal', () => {
    const data = codex({secondary: window, extraRateWindows: [{title: 'Codex Spark 5-hour', window: {...window, usedPercent: 0, windowMinutes: 300}}]});
    assert(data.windows.length === 1 && data.windows[0].id === 'secondary');
    const onlySpark = codex({primary: {...window, windowMinutes: 300}, extraRateWindows: [{title: 'Spark Weekly', window}]});
    assert(onlySpark.windows.length === 0 && indicatorWindow(onlySpark) === null);
});
test('Ritmo semanal a mitad de ventana', () => {
    const rhythm = pace(weeklyWindow(codex({secondary: window})), now);
    assert(rhythm.idealRemaining === 50 && rhythm.delta === 38 && rhythm.status === 'good');
});
test('Ritmo adelantado, fechas anteriores a la ventana y reinicio vencido', () => {
    const quota = weeklyWindow(codex({secondary: {...window, usedPercent: 80}}));
    assert(pace(quota, now).status === 'warning');
    assert(pace(quota, now - 10 * 86400000).idealRemaining === 100);
    assert(pace(quota, quota.resetsAt) === null);
    assert(countdown(quota.resetsAt, quota.resetsAt) === 'Pendiente de actualizar');
});
test('Los datos inválidos no se muestran como saldo o consumo cero', () => {
    rejects(() => codex({secondary: {...window, usedPercent: null}}));
    rejects(() => codex({secondary: {...window, usedPercent: -1}}));
    rejects(() => normalizeCodex([{provider: 'codex', error: {code: 1}}]));
    rejects(() => normalizeDeepSeek({is_available: true, balance_infos: [balance('')]}));
    rejects(() => normalizeDeepSeek({is_available: true, balance_infos: []}));
    rejects(() => normalizeDeepSeek({is_available: true, balance_infos: [balance('1', '<USD>')]}));
});
test('Porcentaje válido sin fecha conserva la cuota sin inventar reinicio', () => {
    const quota = codex({secondary: {...window, resetsAt: null}}).windows[0];
    assert(quota.remaining === 88 && quota.resetsAt === null);
    assert(pace(quota, now) === null);
});
test('Cuota sobrepasada muestra cero restante', () => {
    assert(codex({secondary: {...window, usedPercent: 120}}).windows[0].remaining === 0);
});
test('Saldo cero y cuenta sin disponibilidad', () => {
    const data = normalizeDeepSeek({is_available: false, balance_infos: [balance('0.00')]});
    assert(!data.available && data.balances[0].total === 0);
});
test('Se conservan monedas distintas, saldos negativos y promocionales', () => {
    const data = normalizeDeepSeek({is_available: true, balance_infos: [balance('12.34'), {...balance('-0.01', 'CNY'), granted_balance: '1.25'}]});
    assert(data.balances.length === 2 && data.balances[1].currency === 'CNY');
    assert(data.balances[1].total === -0.01 && data.balances[1].promotional === 1.25);
    assert(money(0.001, 'USD').includes('0,001'));
});
test('Las cuentas atrás redondean sin mostrar tiempos negativos', () => {
    assert(countdown(now + 86400000 + 7200000, now) === '1 d 2 h');
    assert(countdown(now + 1, now) === '1 min');
});
print(passed + ' pruebas de datos correctas.');
