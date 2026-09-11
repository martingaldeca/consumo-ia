import GLib from 'gi://GLib';
import {UsageMonitor} from '../extension/monitor.js';
import {UsageError} from '../extension/model.js';

const loop = new GLib.MainLoop(null, false);
let failure = null;
let passed = 0;
function assert(value) {
    if (!value)
        throw new Error('Assertion failed');
}
async function test(name, run) {
    await run();
    passed++;
    print('✓ ' + name);
}
async function run() {
    await test('Un proveedor puede fallar sin bloquear al otro', async () => {
        const monitor = new UsageMonitor(() => {}, {
            codex: async () => ({windows: []}),
            deepseek: async () => { throw new UsageError('unauthorized'); },
        });
        await monitor.refreshAll();
        assert(monitor.states.codex.data !== null && monitor.states.deepseek.error === 'unauthorized');
        assert(monitor.jobs.size === 0);
        monitor.dispose();
    });
    await test('Un fallo conserva el último dato y su fecha', async () => {
        let fail = false;
        const monitor = new UsageMonitor(() => {}, {codex: async () => {
            if (fail)
                throw new UsageError('timeout');
            return {remaining: 88};
        }});
        await monitor.refresh('codex');
        const updatedAt = monitor.states.codex.updatedAt;
        fail = true;
        await monitor.refresh('codex');
        assert(monitor.states.codex.data.remaining === 88 && monitor.states.codex.updatedAt === updatedAt);
        assert(monitor.states.codex.error === 'timeout');
        monitor.dispose();
    });
    await test('No se solapan consultas ni se repite al abrir con datos recientes', async () => {
        let calls = 0;
        let complete;
        const monitor = new UsageMonitor(() => {}, {codex: () => {
            calls++;
            return new Promise(resolve => { complete = resolve; });
        }});
        const first = monitor.refresh('codex');
        await monitor.refresh('codex');
        assert(calls === 1);
        complete({remaining: 88});
        await first;
        await monitor.refresh('codex', true);
        assert(calls === 1);
        monitor.dispose();
    });
    await test('Desactivar cancela y descarta respuestas tardías', async () => {
        let complete;
        let cancelled = false;
        const monitor = new UsageMonitor(() => {}, {codex: cancellable => {
            cancellable.connect(() => { cancelled = true; });
            return new Promise(resolve => { complete = resolve; });
        }});
        const request = monitor.refresh('codex');
        monitor.setEnabled('codex', false);
        complete({remaining: 88});
        await request;
        assert(cancelled && monitor.states.codex.data === null && monitor.jobs.size === 0);
        monitor.dispose();
    });
    await test('Cerrar el monitor elimina trabajos y callbacks pendientes', async () => {
        let complete;
        let notifications = 0;
        const monitor = new UsageMonitor(() => { notifications++; }, {codex: () => new Promise(resolve => { complete = resolve; })});
        const request = monitor.refresh('codex');
        monitor.dispose();
        complete({remaining: 88});
        await request;
        assert(notifications === 1 && monitor.jobs.size === 0);
    });
    print(passed + ' pruebas de actualización correctas.');
}
run().catch(error => { failure = error; }).finally(() => loop.quit());
loop.run();
if (failure)
    throw failure;
