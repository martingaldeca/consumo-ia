import {retireExecutor} from '../extension/migration.js';

class Settings {
    constructor(values) { this.values = values; }
    get_string(key) { return this.values[key]; }
    set_string(key, value) { this.values[key] = value; }
}

function assert(value) {
    if (!value)
        throw new Error('Assertion failed');
}

const original = [
    {uuid: 'legacy', command: '~/scripts/imprimir_barra_codex.sh', interval: 30},
    {uuid: 'other', command: 'echo unrelated', isActive: true, interval: 5},
    {uuid: 'already-off', command: '~/scripts/imprimir_barra_codex.sh', isActive: false},
    {uuid: 'different', command: 'echo ~/scripts/imprimir_barra_codex.sh', isActive: true},
];
const settings = new Settings({'executor-backup': '[{"uuid":"legacy"}]'});
const executor = new Settings(Object.fromEntries(['left', 'center', 'right'].map(position =>
    [position + '-commands-json', JSON.stringify({commands: position === 'right' ? original : [], extra: 'preserved'})])));
const left = executor.get_string('left-commands-json');
assert(retireExecutor(settings, executor) === 2);
const retained = JSON.parse(executor.get_string('right-commands-json'));
assert(JSON.stringify(retained.commands) === JSON.stringify([original[1], original[3]]));
assert(retained.extra === 'preserved' && executor.get_string('left-commands-json') === left);
print('✓ Se retiran solamente las entradas exactas, activas o desactivadas');
assert(settings.get_string('executor-backup') === '[]');
print('✓ Se elimina el respaldo que hacía reaparecer la barra');
const after = executor.get_string('right-commands-json');
assert(retireExecutor(settings, executor) === 0 && after === executor.get_string('right-commands-json'));
print('✓ Repetir la retirada no cambia la configuración restante');
assert(retireExecutor(settings, null) === 0);
print('✓ La retirada tolera que Executor no esté instalado');
print('4 pruebas de retirada correctas.');
