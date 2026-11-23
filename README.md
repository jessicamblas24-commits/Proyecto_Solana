# Tablero de tareas en Solana

**Ruta elegida:** proyecto propio (tema: tareas).
**Plantilla de partida:** estructura estándar de `anchor init` y `@solana/wallet-adapter`; programa, IDL, cliente, tests y frontend son propios.
**Autor:** <TU NOMBRE PARA EL CERTIFICADO> · **Correo de registro:** <TU CORREO>
**Program ID (Devnet):** `<PEGA AQUÍ EL PROGRAM ID DESPLEGADO>` · [Explorer](https://explorer.solana.com/address/<PROGRAM_ID>?cluster=devnet)

## Propósito
Un tablero de tareas on-chain: el dueño crea el tablero y asigna tareas; cada persona asignada mueve *su* tarea de Pendiente → En curso → Hecha; el dueño elimina tareas terminadas y, al final, el tablero vacío.

## Modelo de cuentas

| Cuenta  | PDA (semillas)                         | Quién paga | Relación |
|---------|-----------------------------------------|-----------|----------|
| Tablero | `["tablero", authority, nombre]`        | el dueño  | raíz |
| Tarea   | `["tarea", tablero, id (u32 LE)]`       | el dueño  | `tarea.tablero` → Tablero (`has_one`) |

`id` debe ser `tablero.siguiente_id`: el programa rechaza cualquier otro, así que los ids son secuenciales y la PDA de cada tarea es única.

## Operaciones, permisos y reglas

| Instrucción | Operación | Quién puede | Regla del programa |
|---|---|---|---|
| `crear_tablero` | crear | cualquiera (será dueño) | nombre 1..32 bytes |
| `crear_tarea` | crear (relacionada) | solo el dueño | `id == siguiente_id`, título 1..64, prioridad 1..3 |
| `reasignar_tarea` | modificar | solo el dueño | no si la tarea ya está Hecha |
| `avanzar_tarea` | modificar | **solo el asignado** (ni el dueño) | solo hacia adelante; Hecha es final |
| `cerrar_tarea` | **baja** | solo el dueño | **solo si está Hecha**; renta al dueño; decrementa contador |
| `cerrar_tablero` | **baja** | solo el dueño | **solo si `tareas_abiertas == 0`** |

Lectura: `leerTablero`, `leerTarea`, `listarTareas` (memcmp sobre `tablero`, offset 8) en `src/lib/client.ts`.

## Aporte propio (explicable y comprobable)
1. **Permisos por rol** distintos: el dueño administra, pero solo el asignado puede mover la tarea (incluso el dueño es rechazado, C7).
2. **Id secuencial validado en Rust** que deriva la PDA y evita colisiones y saltos (C6).
3. **Baja de tarea condicionada** a estado Hecha, con renta devuelta a quien la pagó (C10, C12).
4. **Baja de tablero condicionada** a que no queden tareas, con contador mantenido por el programa (C13, C14).

## Pruebas y evidencias (correspondencia)
Cada `it` de `tests/tareas.ts` lleva su ID (C1…C14); renómbralos a los de tu documento si hace falta.

| Tipo de caso | Tests | Evidencia sugerida |
|---|---|---|
| Creación cuenta raíz | C1, C2 (rechazo) | firma + vista del tablero |
| Creación cuenta relacionada / PDA | C3, C5, C6 | firma; contadores del tablero |
| Lectura | C1, C3, C4 | salida de tests / frontend |
| Modificación | C7, C8, C9 | estado antes y después |
| Permisos (rechazos) | C5, C7, C9, C11, C14 | error `NoAutorizado` en el registro |
| Baja condicionada (rechazo y éxito) | C10↔C12, C13↔C14 | `EstadoNoHecha` / `TableroConTareas`; cuenta `null` |
| Coherencia cliente-IDL | todos | `anchor build` y comparación con `src/idl/tareas.json` |
| Frontend con wallet | flujo manual | capturas con firmas y enlaces al explorador |

La casilla "Enviar aunque la interfaz lo bloquee" del frontend permite mostrar en vivo el rechazo del programa.

## Requisitos
Node 18+, Rust, Solana CLI, Anchor 0.31.1 (`avm install 0.31.1 && avm use 0.31.1`), una wallet de navegador (Phantom/Solflare) en **Devnet**.
Sin instalar nada: abre el repo en **GitHub Codespaces** y usa el mismo flujo.

## Pasos de ejecución
```bash
npm install
anchor build
anchor keys sync          # genera TU program id y lo escribe en lib.rs y Anchor.toml
python3 scripts/gen_idl.py $(solana address -k target/deploy/tareas-keypair.json)   # regenera el IDL con ese id
anchor build              # recompila con el id nuevo
anchor test               # validador local + C1..C14

# Devnet
solana config set --url devnet
solana airdrop 2          # o https://faucet.solana.com
anchor deploy --provider.cluster devnet
npm run dev               # abre http://localhost:5173 con la wallet en Devnet
```
Alternativa al paso del IDL: copia `target/idl/tareas.json` a `src/idl/tareas.json` después de `anchor build`.
Para probar permisos en el frontend necesitas dos wallets: crea la tarea asignándola a la dirección de la segunda y cambia de cuenta en la wallet.

## Notas
- El Program ID incluido es provisional; el definitivo es el que obtienes con `anchor keys sync` y despliegas.
- Reutilizado: Anchor, wallet-adapter, Vite, React. Todo lo demás es propio.
- Límites: las prioridades son numéricas (1–3) y el asignado es una sola wallet.
