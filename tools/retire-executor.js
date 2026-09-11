import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {retireExecutor} from '../extension/migration.js';

const directory = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'consumo-ia@local', 'schemas']);
const source = Gio.SettingsSchemaSource.new_from_directory(directory, Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.consumo-ia', false)});
const removed = retireExecutor(settings);
Gio.Settings.sync();
print('Entradas antiguas retiradas: ' + removed);
