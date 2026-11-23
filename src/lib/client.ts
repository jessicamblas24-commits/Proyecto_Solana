// Cliente único: lo usan los tests (Anchor/mocha) y el frontend (React).
// Los nombres de instrucciones y campos salen de src/idl/tareas.json.
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "../idl/tareas.json";

export const PROGRAM_ID = new PublicKey((idl as { address: string }).address);
const enc = new TextEncoder();

export type Estado = "pendiente" | "enCurso" | "hecha";

export interface TableroData {
  authority: PublicKey;
  nombre: string;
  siguienteId: number;
  tareasAbiertas: number;
  bump: number;
}
export interface TareaData {
  tablero: PublicKey;
  id: number;
  titulo: string;
  asignado: PublicKey;
  prioridad: number;
  estado: Record<string, unknown>;
  creadaEn: { toNumber(): number };
  bump: number;
}
export type TareaFila = { publicKey: PublicKey; account: TareaData };

export const getProgram = (provider: AnchorProvider) => new Program(idl as Idl, provider);
export type TareasProgram = ReturnType<typeof getProgram>;

// ── PDAs: deben coincidir con `seeds` del programa ──
export const tableroPda = (authority: PublicKey, nombre: string) =>
  PublicKey.findProgramAddressSync(
    [enc.encode("tablero"), authority.toBytes(), enc.encode(nombre)],
    PROGRAM_ID
  )[0];

export const tareaPda = (tablero: PublicKey, id: number) => {
  const le = new Uint8Array(4);
  new DataView(le.buffer).setUint32(0, id, true); // u32 little-endian = to_le_bytes()
  return PublicKey.findProgramAddressSync([enc.encode("tarea"), tablero.toBytes(), le], PROGRAM_ID)[0];
};

export const estadoDe = (t: TareaData): Estado => Object.keys(t.estado)[0] as Estado;

// ── Lectura ──
export const leerTablero = async (p: TareasProgram, tablero: PublicKey) =>
  (await (p.account as any).tablero.fetchNullable(tablero)) as TableroData | null;

export const leerTarea = async (p: TareasProgram, tarea: PublicKey) =>
  (await (p.account as any).tarea.fetchNullable(tarea)) as TareaData | null;

/** Todas las tareas de un tablero (memcmp sobre el campo `tablero`, offset 8). */
export const listarTareas = async (p: TareasProgram, tablero: PublicKey) =>
  ((await (p.account as any).tarea.all([
    { memcmp: { offset: 8, bytes: tablero.toBase58() } },
  ])) as TareaFila[]).sort((a, b) => a.account.id - b.account.id);

// ── Escritura (devuelven la firma) ──
export const crearTablero = (p: TareasProgram, authority: PublicKey, nombre: string) =>
  p.methods
    .crearTablero(nombre)
    .accountsPartial({ tablero: tableroPda(authority, nombre), authority })
    .rpc();

export const crearTarea = (
  p: TareasProgram, tablero: PublicKey, authority: PublicKey,
  id: number, titulo: string, prioridad: number, asignado: PublicKey
) =>
  p.methods
    .crearTarea(id, titulo, prioridad, asignado)
    .accountsPartial({ tablero, tarea: tareaPda(tablero, id), authority })
    .rpc();

export const reasignarTarea = (
  p: TareasProgram, tablero: PublicKey, id: number, authority: PublicKey, nuevo: PublicKey
) =>
  p.methods
    .reasignarTarea(nuevo)
    .accountsPartial({ tablero, tarea: tareaPda(tablero, id), authority })
    .rpc();

export const avanzarTarea = (p: TareasProgram, tablero: PublicKey, id: number, firmante: PublicKey) =>
  p.methods
    .avanzarTarea()
    .accountsPartial({ tablero, tarea: tareaPda(tablero, id), firmante })
    .rpc();

export const cerrarTarea = (p: TareasProgram, tablero: PublicKey, id: number, authority: PublicKey) =>
  p.methods
    .cerrarTarea()
    .accountsPartial({ tablero, tarea: tareaPda(tablero, id), authority })
    .rpc();

export const cerrarTablero = (p: TareasProgram, tablero: PublicKey, authority: PublicKey) =>
  p.methods.cerrarTablero().accountsPartial({ tablero, authority }).rpc();

/** Traduce errores de Anchor a un mensaje legible (nombre + texto del IDL). */
export const mensajeError = (e: unknown): string => {
  const err = e as { error?: { errorCode?: { code: string }; errorMessage?: string }; message?: string };
  if (err?.error?.errorMessage) return `${err.error.errorCode?.code}: ${err.error.errorMessage}`;
  const m = err?.message ?? String(e);
  return /already in use/.test(m) ? "Esa cuenta ya existe" : m;
};
