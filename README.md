# Consumo IA · v2

Panel para GNOME Shell 46: cuota semanal de Codex, actividad de tokens y evolución del saldo de DeepSeek. Diseño oscuro tipo IDE, cifras monoespaciadas y acentos cian y violeta.

Este repositorio no contiene credenciales ni datos de cuentas. Cada instalación guarda su token de DeepSeek en el llavero local de Ubuntu y su historial en un archivo privado del usuario.

## Instalación

```sh
git clone https://github.com/martingaldeca/consumo-ia.git
cd consumo-ia
bash ./install.sh
```

Cierra sesión y vuelve a entrar después de actualizar. GNOME conserva el JavaScript cargado durante la sesión; volver a activar la extensión no sustituye esos módulos. El instalador no cierra tu sesión.

Si ya tienes `~/.local/bin/codexbar` como módulo de Waybar, el instalador lo conserva como `~/.local/bin/codexbar-waybar` e instala en su lugar el adaptador CLI que necesita esta extensión. Si encuentra el ejecutable `codex` en tu `PATH`, también crea el enlace `~/.local/bin/codex` para habilitar Actividad.

La instalación retira solamente la entrada `~/scripts/imprimir_barra_codex.sh` (o su ruta absoluta) de Executor y reinicia esa extensión si estaba habilitada para cancelar consultas antiguas. Conserva el script, las otras entradas y los archivos `.env`. La barra antigua no se restaura al desactivar Consumo IA.

## Resumen

Haz clic en el indicador. `C` muestra el porcentaje restante semanal y `D` el saldo de DeepSeek. Un guion indica ausencia de datos; `!` indica un fallo de consulta.

La vista inicial muestra Codex y DeepSeek. Spark y sus ventanas no aparecen. Si no hay cuota semanal general, se indica que no está disponible.

La barra representa el porcentaje restante. Su marca blanca es el restante ideal según el tiempo que falta para reiniciar. El color indica la diferencia respecto a ese ritmo: verde a partir de +5 puntos, ámbar en cero y rojo a partir de −5 puntos, con transiciones graduales. Una cuota agotada siempre es roja. Una diferencia positiva significa que has consumido menos que el ritmo uniforme de referencia. El porcentaje `C` de la barra superior usa ese mismo color.

El token de DeepSeek existente se conserva en el llavero de Ubuntu. Para conectarlo o actualizarlo, abre **Ajustes → Conectar DeepSeek → Guardar y comprobar**. Se valida antes de guardarlo; una clave inválida no reemplaza la anterior.

## Tokens

Selecciona **Hoy**, **7 días** o **30 días**:

- **En conjunto:** tokens del período de cada proveedor, su suma, el acumulado de cada uno y las cifras en dólares de DeepSeek.
- **Tokens de Codex:** tokens del período, totales de hoy, 7 y 30 días, acumulado total, pico diario, racha y barras diarias publicadas por tu cuenta. Usa las flechas izquierda/derecha o el puntero para consultar cada valor. Los días se agrupan en UTC; un día ausente no se interpreta como cero.
- **Tokens de DeepSeek:** lo mismo para las sesiones de Codex que usan DeepSeek: tokens del período, totales de hoy, 7 y 30 días, acumulado, pico diario y barras diarias.

Las estadísticas de Codex corresponden a lo que publica tu cuenta. No se deducen de la cuota, no representan costes de la API de OpenAI y no se filtran por modelo.

Los tokens de DeepSeek se leen de los registros de tus sesiones locales de Codex con DeepSeek, en `~/.codex-deepseek/sessions` (el `CODEX_HOME` que usa el comando `deepseek`). Son los tokens que la propia API ha reportado en esas sesiones: no incluyen otros clientes de DeepSeek ni se convierten a dólares. El gasto en dólares se estima con las muestras locales de saldo: se suman las bajadas y las recargas se contabilizan aparte. Por eso puede quedarse corto si faltan muestras o si el historial empezó después del inicio del período.

## Actividad

- **Evolución de cuota:** porcentaje usado a lo largo del período.
- **Evolución de saldo:** saldo de DeepSeek en su moneda. Las variaciones pueden incluir consumo, recargas o promociones; no se etiquetan automáticamente como gasto.

Los dos gráficos se dibujan como una línea continua y suave: un tramo sin muestras se une con trazo discontinuo en lugar de dejar puntos sueltos, y una única muestra aislada se dibuja como una línea de nivel discontinua. La escala vertical se ajusta a lo observado y el máximo y el mínimo aparecen rotulados a la izquierda; el eje horizontal empieza en la primera muestra disponible del período.

## Actualizaciones y almacenamiento

Cuota y saldo se consultan cada 30 segundos por defecto, con opciones de 1 minuto y 5 minutos. La actividad se consulta al iniciar y cada 15 minutos. El botón actualiza todos los datos; abrir el panel consulta solo lo que ha quedado antiguo.

El historial de cuota y saldo se registra desde la activación de esta versión, cada cinco minutos mientras la extensión esté habilitada. Conserva 30 días en `~/.local/share/consumo-ia/history.json` (o el equivalente de `XDG_DATA_HOME`), con permisos privados y escrituras atómicas. Solo contiene fechas y métricas, sin claves, conversaciones ni solicitudes.

Los tokens de DeepSeek no se copian: la extensión guarda en `consumo-ia/sessions.json`, junto a ese historial, solo el recuento por día y hasta dónde ha leído cada fichero de sesión, para no volver a procesarlo entero en cada consulta. Si borras ese archivo, se reconstruye leyendo otra vez las sesiones.

Los huecos de más de 15 minutos se dibujan con trazo discontinuo. Una única muestra inicial es normal: hacen falta varias para ver la evolución. No hay un servicio adicional cuando la extensión está desactivada.

Las tres consultas son independientes y tienen un límite de 25 segundos. Un fallo conserva los últimos datos válidos e indica su antigüedad. El historial local sobrevive al cierre de sesión.

## Comprobaciones

```sh
for suite in model monitor migration activity history series sessions codexbar-cli; do
    gjs -m "$HOME/scripts/consumo-ia/tests/$suite.test.js"
done
glib-compile-schemas --strict --dry-run ~/scripts/consumo-ia/extension/schemas
```

No se ejecutan E2E ni builds de producción. Comprobación visual por el usuario: contraste y colores, ausencia de Spark y de la barra antigua, ambos proveedores en Resumen, las pestañas Resumen, Actividad y Tokens, filtros y teclado en los gráficos, color del porcentaje en la barra superior, escalado y cierre con Escape.

Dependencias: GNOME Shell 46, GJS, GTK4, libadwaita, Soup 3, Libsecret, el llavero de sesión y una sesión autenticada de Codex CLI. El instalador adapta un `codexbar` de Waybar existente y enlaza `~/.local/bin/codex` cuando el CLI está disponible. No requiere Node en ejecución ni cambios en tus clientes de DeepSeek.

Para desactivar: `gnome-extensions disable consumo-ia@local`.

Fuentes: [actividad de Codex](https://learn.chatgpt.com/docs/app-server), [saldo de DeepSeek](https://api-docs.deepseek.com/api/get-user-balance/), [recarga de extensiones](https://gjs.guide/extensions/development/debugging.html#reloading-extensions).
