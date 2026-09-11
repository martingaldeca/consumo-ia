import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function executorSettings() {
    const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'executor@raujonas.github.io', 'schemas']);
    if (!GLib.file_test(GLib.build_filenamev([path, 'gschemas.compiled']), GLib.FileTest.EXISTS))
        return null;
    const source = Gio.SettingsSchemaSource.new_from_directory(path, Gio.SettingsSchemaSource.get_default(), false);
    const schema = source.lookup('org.gnome.shell.extensions.executor', false);
    return schema ? new Gio.Settings({settings_schema: schema}) : null;
}

export function isLegacyCommand(command) {
    return ['~/scripts/imprimir_barra_codex.sh', GLib.build_filenamev([GLib.get_home_dir(), 'scripts', 'imprimir_barra_codex.sh'])].includes(command?.trim());
}

export function retireExecutor(settings, executor = executorSettings()) {
    let removed = 0;
    if (executor) {
        for (const position of ['left', 'center', 'right']) {
            const key = position + '-commands-json';
            const config = JSON.parse(executor.get_string(key));
            if (!Array.isArray(config.commands))
                continue;
            const retained = config.commands.filter(command => !isLegacyCommand(command.command));
            if (retained.length !== config.commands.length) {
                removed += config.commands.length - retained.length;
                config.commands = retained;
                executor.set_string(key, JSON.stringify(config));
            }
        }
    }
    settings.set_string('executor-backup', '[]');
    return removed;
}
