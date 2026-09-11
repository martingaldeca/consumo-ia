#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
extension_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/consumo-ia@local"
executor_enabled=false

glib-compile-schemas --strict --dry-run "$project_dir/extension/schemas"
for suite in model monitor migration activity history; do
    gjs -m "$project_dir/tests/$suite.test.js"
done

restore_extensions() {
    if "$executor_enabled"; then
        gnome-extensions enable executor@raujonas.github.io >/dev/null 2>&1 || true
    fi
    gnome-extensions enable consumo-ia@local >/dev/null 2>&1 || true
}
trap restore_extensions EXIT

if gnome-extensions info consumo-ia@local >/dev/null 2>&1; then
    gnome-extensions disable consumo-ia@local
fi
if gnome-extensions list --enabled | grep -Fxq 'executor@raujonas.github.io'; then
    executor_enabled=true
    gnome-extensions disable executor@raujonas.github.io
fi

install -d "$extension_dir/schemas"
for filename in metadata.json extension.js model.js providers.js monitor.js history.js charts.js migration.js prefs.js stylesheet.css; do
    install -m 644 "$project_dir/extension/$filename" "$extension_dir/$filename"
done
install -m 644 "$project_dir/extension/schemas/org.gnome.shell.extensions.consumo-ia.gschema.xml" "$extension_dir/schemas/"
glib-compile-schemas --strict "$extension_dir/schemas"
gjs -m "$project_dir/tools/retire-executor.js"

restore_extensions
trap - EXIT
gjs -c 'const s = new imports.gi.Gio.Settings({schema_id: "org.gnome.shell"}); const ids = s.get_strv("enabled-extensions"); if (!ids.includes("consumo-ia@local")) s.set_strv("enabled-extensions", [...ids, "consumo-ia@local"]); imports.gi.Gio.Settings.sync();'
echo 'Consumo IA v2 instalado. La entrada antigua de Executor se ha retirado.'
echo 'Cierra sesión y vuelve a entrar para cargar el nuevo JavaScript de GNOME.'
echo 'Hasta entonces, la sesión puede conservar el panel de Consumo IA anterior.'
