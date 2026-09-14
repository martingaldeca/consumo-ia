#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
extension_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/consumo-ia@local"
codexbar_binary="$HOME/.local/bin/codexbar"
codexbar_waybar_binary="$HOME/.local/bin/codexbar-waybar"
codex_binary="$HOME/.local/bin/codex"
executor_enabled=false

glib-compile-schemas --strict --dry-run "$project_dir/extension/schemas"
for suite in model monitor migration activity history series sessions; do
    gjs -m "$project_dir/tests/$suite.test.js"
done
gjs -m "$project_dir/tests/codexbar-cli.test.js"

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
for filename in metadata.json extension.js model.js providers.js monitor.js history.js series.js sessions.js charts.js migration.js prefs.js stylesheet.css; do
    install -m 644 "$project_dir/extension/$filename" "$extension_dir/$filename"
done
install -m 644 "$project_dir/extension/schemas/org.gnome.shell.extensions.consumo-ia.gschema.xml" "$extension_dir/schemas/"
glib-compile-schemas --strict "$extension_dir/schemas"

if [[ -x "$codexbar_binary" ]] && ! grep -q 'Consumo IA CodexBar compatibility adapter' "$codexbar_binary"; then
    if [[ ! -e "$codexbar_waybar_binary" ]]; then
        install -m 755 "$codexbar_binary" "$codexbar_waybar_binary"
    fi
fi
if [[ -x "$codexbar_waybar_binary" ]]; then
    install -m 755 "$project_dir/tools/codexbar-cli" "$codexbar_binary"
    echo 'CodexBar Waybar respaldado como ~/.local/bin/codexbar-waybar.'
    echo 'Adaptador CLI de CodexBar instalado en ~/.local/bin/codexbar.'
fi

if [[ ! -e "$codex_binary" ]]; then
    codex_command="$(command -v codex || true)"
    if [[ -n "$codex_command" && -x "$codex_command" ]]; then
        ln -s "$codex_command" "$codex_binary"
        echo 'Codex CLI enlazado en ~/.local/bin/codex para habilitar Actividad.'
    fi
fi

gjs -m "$project_dir/tools/retire-executor.js"

restore_extensions
trap - EXIT
gjs -c 'const s = new imports.gi.Gio.Settings({schema_id: "org.gnome.shell"}); const ids = s.get_strv("enabled-extensions"); if (!ids.includes("consumo-ia@local")) s.set_strv("enabled-extensions", [...ids, "consumo-ia@local"]); imports.gi.Gio.Settings.sync();'
echo 'Consumo IA v2 instalado. La entrada antigua de Executor se ha retirado.'
echo 'Cierra sesión y vuelve a entrar para cargar el nuevo JavaScript de GNOME.'
echo 'Hasta entonces, la sesión puede conservar el panel de Consumo IA anterior.'
