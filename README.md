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

La instalación retira solamente la entrada `~/scripts/imprimir_barra_codex.sh` (o su ruta absoluta) de Executor y reinicia esa extensión si estaba habilitada para cancelar consultas antiguas. Conserva el script, las otras entradas y los archivos `.env`. La barra antigua no se restaura al desactivar Consumo IA.

## Resumen

Haz clic en el indicador. `C` muestra el porcentaje restante semanal y `D` el saldo de DeepSeek. Un guion indica ausencia de datos; `!` indica un fallo de consulta.

La vista inicial muestra Codex y DeepSeek. Spark y sus ventanas no aparecen. Si no hay cuota semanal general, se indica que no está disponible.

La barra representa el porcentaje restante. Su marca blanca es el restante ideal según el tiempo que falta para reiniciar. El color indica la diferencia respecto a ese ritmo: verde a partir de +5 puntos, ámbar en cero y rojo a partir de −5 puntos, con transiciones graduales. Una cuota agotada siempre es roja. Una diferencia positiva significa que has consumido menos que el ritmo uniforme de referencia.

El token de DeepSeek existente se conserva en el llavero de Ubuntu. Para conectarlo o actualizarlo, abre **Ajustes → Conectar DeepSeek → Guardar y comprobar**. Se valida antes de guardarlo; una clave inválida no reemplaza la anterior.

## Actividad

Selecciona **Hoy**, **7 días** o **30 días**:

- **Tokens de Codex:** barras diarias, tokens del período, total acumulado y pico diario publicados por tu cuenta. Usa las flechas izquierda/derecha o el puntero para consultar cada valor. Los días se agrupan en UTC; un día ausente no se interpreta como cero.
- **Evolución de cuota:** porcentaje usado. Cada ciclo semanal se dibuja por separado.
- **Evolución de saldo:** saldo de DeepSeek en su moneda. Las variaciones pueden incluir consumo, recargas o promociones; no se etiquetan automáticamente como gasto.

Las estadísticas de tokens corresponden a lo que publica tu cuenta de Codex. No se deducen de la cuota, no representan costes de la API de OpenAI y no se filtran por modelo.

## Actualizaciones y almacenamiento

Cuota y saldo se consultan cada 30 segundos por defecto, con opciones de 1 minuto y 5 minutos. La actividad se consulta al iniciar y cada 15 minutos. El botón actualiza todos los datos; abrir el panel consulta solo lo que ha quedado antiguo.

El historial de cuota y saldo se registra desde la activación de esta versión, cada cinco minutos mientras la extensión esté habilitada. Conserva 30 días en `~/.local/share/consumo-ia/history.json` (o el equivalente de `XDG_DATA_HOME`), con permisos privados y escrituras atómicas. Solo contiene fechas y métricas, sin claves, conversaciones ni solicitudes.

Los huecos de más de 15 minutos se muestran separados. Un único punto inicial es normal: hacen falta varias muestras para ver la evolución. No hay un servicio adicional cuando la extensión está desactivada.

Las tres consultas son independientes y tienen un límite de 25 segundos. Un fallo conserva los últimos datos válidos e indica su antigüedad. El historial local sobrevive al cierre de sesión.

## Comprobaciones

```sh
for suite in model monitor migration activity history; do
    gjs -m "$HOME/scripts/consumo-ia/tests/$suite.test.js"
done
glib-compile-schemas --strict --dry-run ~/scripts/consumo-ia/extension/schemas
```

No se ejecutan E2E ni builds de producción. Comprobación visual por el usuario: contraste y colores, ausencia de Spark y de la barra antigua, ambos proveedores en Resumen, filtros y teclado en Actividad, escalado y cierre con Escape.

Dependencias: GNOME Shell 46, GJS, GTK4, libadwaita, Soup 3, Libsecret, el llavero de sesión y los ejecutables autenticados `~/.local/bin/codexbar` y `~/.local/bin/codex`. No requiere Node en ejecución ni cambios en tus clientes de DeepSeek.

Para desactivar: `gnome-extensions disable consumo-ia@local`.

Fuentes: [actividad de Codex](https://learn.chatgpt.com/docs/app-server), [saldo de DeepSeek](https://api-docs.deepseek.com/api/get-user-balance/), [recarga de extensiones](https://gjs.guide/extensions/development/debugging.html#reloading-extensions).
