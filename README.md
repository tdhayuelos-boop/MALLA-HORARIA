# Malla horaria

Página estática (HTML + JavaScript, sin instalar nada) que guarda en Supabase y se publica en Vercel.

## 1. Crear la base de datos (Supabase)
1. Crea un proyecto en https://supabase.com
2. Abre **SQL Editor → New query**, pega todo `schema.sql` y presiona **Run**. Se puede repetir sin perder datos.
3. Ve a **Project Settings → API** y copia **Project URL** y **anon public key**.
4. Pégalos en `config.js`. Ahí mismo está `ADMIN_CODE` (9462).

## 2. Publicar en Vercel
- **Opción A:** sube esta carpeta a un repositorio de GitHub, en https://vercel.com elige **Add New → Project**, importa el repositorio y presiona **Deploy** (Framework: "Other").
- **Opción B:** dentro de la carpeta ejecuta `npx vercel` y sigue las preguntas.

**Importante, apenas se publique:** entra tú primero con el código **9462** y elige la clave del ADMIN. El primer ingreso de un código crea el usuario.

Si `config.js` queda vacío, la página funciona pero guarda solo en ese navegador (sirve para probar).

## 3. Cómo funciona

### Ingreso
Código + clave. Con un código nuevo pide nombre y clave y crea el usuario. El ADMIN puede restablecer claves (botón con su nombre, arriba a la derecha).

### Malla
- **Entrada** `8` → 08:00 · **Salida** `8` → 20:00 (también `8:30`, `830`).
- Códigos (se escriben en la entrada y la salida se llena sola; abajo sale la palabra completa): `C` compensatorio · `D` descanso · `F` festivo · `INV` inventario · `INC` incapacidad · `VAC` vacaciones · `AUS` ausencia · `LIC` licencia.
- Selector de **mes y año**; los **festivos de Colombia** se calculan solos y se marcan en la malla.
- **Turnos:** APERTURA 2, APERTURA 3, CIERRE 2, CIERRE 3 (se editan en el botón "Turnos").
  - Horario fuera de lista con salida a las 20:00 o después: la página sugiere el cierre y el usuario acepta o elige otro. Sin noche: muestra la lista directo.
  - Las horas que quedan fuera del turno (por ejemplo 10:00–12:00 en un 10 a 20 con CIERRE 2) suman al **contador de horas**.
- Haz clic en una celda de abajo para ver el horario real, cómo se clasificó y cambiar el turno.

### Clasificación de horas
| | Día normal | Domingo o festivo |
|---|---|---|
| Después de las 19:00, dentro del turno | HRN | HRND&F |
| Después de las 19:00, pasando el turno | HRN | HEND&F |
| Extra diurna | solo contador (sin nómina) | HEF |
| Jornada del día | — | HFC (1 o 2 días) / HF (3 o más) |

- Jornada: 7 horas (8 del turno menos 1 de almuerzo, todos los días).
- HFC / HF se calculan **por quincena y por mes** por separado.
- `INV` en dos días seguidos = 7 HRN + 2 HEN (se pagan en la quincena del primer día), cuenta como los dos días trabajados y como el descanso de la semana (esa semana no puede llevar `C` ni `D`).
- `C`, `D` y `F` no suman horas trabajadas.

### Descansos (semana de domingo a sábado)
- Cada semana tiene un solo descanso: `C` el domingo, o un `D` entre semana, o el par de INV.
- `D` en domingo: pregunta si se corrige a `C`.
- Segundo descanso: pregunta si se descuentan 7 horas pendientes. Solo se acepta si el sobrante es un `D`; si dices que no, no se guarda.
- `INC`, `LIC` o `AUS` antes de un descanso en la misma semana: no deja poner el descanso después. Si el descanso va primero, no pasa nada.
- Con un inventario (dos INV seguidos) la semana no puede tener ni `C` ni `D`: no deja guardarlos.
- Mes que empieza a mitad de semana: al registrar el día 1 pregunta si hubo descanso en el mes anterior (si ya hay datos del mes anterior, los usa y no pregunta).

### Nómina
Por persona: **Q1** (1–15), **Q2** (16–fin) y **Mes**. Días (15 / 15 / 30 menos INC, VAC, AUS, LIC), contadores de INC/VAC/AUS/LIC, HFC, HF, HRN, HRND&F, HEND&F, HEN y HEF. Debajo, el **saldo de horas**, que pasa solo de un mes al siguiente.

### Horas manuales
Un recuadro por persona, positivas o negativas, siempre con motivo. Un negativo que coincida con un positivo anterior pregunta si lo anula (y pide el motivo de la anulación). Van al mismo contador de horas.

### Correcciones
- Dentro de 1 hora desde que se escribió: libre (el movimiento anterior queda tachado en el registro).
- Pasada 1 hora: comentario obligatorio.
- Después del día 5 del mes siguiente: solo con el código y la clave del ADMIN, y siempre con comentario.

### Registro (consola) y Excel
Cada movimiento queda guardado con usuario, fecha y hora, antes y después, y comentario. No se puede borrar. Filtros por persona, usuario, tipo, fechas y texto. Desde la pestaña Registro y la de Nómina se descargan los Excel detallados.

## Notas
- Seguridad: es de uso interno. Con `schema.sql` tal cual, quien tenga el enlace y un código de usuario puede trabajar. La tabla del registro no permite editar ni borrar.
- Los cambios en los turnos aplican de ahí en adelante; lo ya registrado no se recalcula.
- Pruebas de las reglas: `node tests/core.test.js`.
