import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as c from "../src/lib/client";

// Cada `it` lleva el ID del caso (C1..C14) que usa el README → "Pruebas y evidencias".
describe("tareas", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = c.getProgram(provider);
  const dueno = provider.wallet.publicKey;
  const nombre = `tab-${Date.now() % 1e9}`;
  const tablero = c.tableroPda(dueno, nombre);
  const colab = Keypair.generate();   // asignado de las tareas
  const intruso = Keypair.generate(); // sin ningún rol

  const como = (kp: Keypair) =>
    c.getProgram(new anchor.AnchorProvider(provider.connection, new anchor.Wallet(kp), {}));

  const fallaCon = async (p: Promise<unknown>, re: RegExp) => {
    try { await p; } catch (e) { expect(c.mensajeError(e) + String(e)).to.match(re); return; }
    expect.fail("la transacción debía fallar");
  };

  before(async () => {
    for (const kp of [colab, intruso]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
  });

  it("C1 crea el tablero (PDA derivada) y lo lee", async () => {
    await c.crearTablero(program, dueno, nombre);
    const t = await c.leerTablero(program, tablero);
    expect(t!.authority.equals(dueno)).to.be.true;
    expect(t!.nombre).to.eq(nombre);
    expect([t!.siguienteId, t!.tareasAbiertas]).to.deep.eq([0, 0]);
  });

  it("C2 rechaza un nombre vacío", async () => {
    await fallaCon(c.crearTablero(program, dueno, ""), /NombreInvalido/);
  });

  it("C3 crea una tarea relacionada y actualiza contadores del tablero", async () => {
    await c.crearTarea(program, tablero, dueno, 0, "Escribir README", 1, colab.publicKey);
    const x = await c.leerTarea(program, c.tareaPda(tablero, 0));
    expect(x!.titulo).to.eq("Escribir README");
    expect(x!.asignado.equals(colab.publicKey)).to.be.true;
    expect(c.estadoDe(x!)).to.eq("pendiente");
    const t = await c.leerTablero(program, tablero);
    expect([t!.siguienteId, t!.tareasAbiertas]).to.deep.eq([1, 1]);
  });

  it("C4 lista las tareas del tablero (memcmp)", async () => {
    const todas = await c.listarTareas(program, tablero);
    expect(todas.map((f) => f.account.id)).to.deep.eq([0]);
  });

  it("C5 solo el dueño crea tareas", async () => {
    await fallaCon(c.crearTarea(como(intruso), tablero, intruso.publicKey, 1, "X", 2, intruso.publicKey), /NoAutorizado/);
  });

  it("C6 el id debe ser el siguiente; la prioridad, 1..3", async () => {
    await fallaCon(c.crearTarea(program, tablero, dueno, 7, "Salto de id", 2, colab.publicKey), /IdInvalido/);
    await fallaCon(c.crearTarea(program, tablero, dueno, 1, "Prioridad mala", 9, colab.publicKey), /PrioridadInvalida/);
  });

  it("C7 solo el asignado avanza la tarea (ni el dueño ni un tercero)", async () => {
    await fallaCon(c.avanzarTarea(como(intruso), tablero, 0, intruso.publicKey), /NoAutorizado/);
    await fallaCon(c.avanzarTarea(program, tablero, 0, dueno), /NoAutorizado/);
    await c.avanzarTarea(como(colab), tablero, 0, colab.publicKey);
    expect(c.estadoDe((await c.leerTarea(program, c.tareaPda(tablero, 0)))!)).to.eq("enCurso");
  });

  it("C8 el estado solo avanza hacia adelante y termina en Hecha", async () => {
    await c.avanzarTarea(como(colab), tablero, 0, colab.publicKey);
    expect(c.estadoDe((await c.leerTarea(program, c.tareaPda(tablero, 0)))!)).to.eq("hecha");
    await fallaCon(c.avanzarTarea(como(colab), tablero, 0, colab.publicKey), /TransicionInvalida/);
  });

  it("C9 solo el dueño reasigna; no una tarea Hecha", async () => {
    await c.crearTarea(program, tablero, dueno, 1, "Grabar demo", 2, dueno);
    await fallaCon(c.reasignarTarea(como(intruso), tablero, 1, intruso.publicKey, intruso.publicKey), /NoAutorizado/);
    await c.reasignarTarea(program, tablero, 1, dueno, colab.publicKey);
    expect((await c.leerTarea(program, c.tareaPda(tablero, 1)))!.asignado.equals(colab.publicKey)).to.be.true;
    await fallaCon(c.reasignarTarea(program, tablero, 0, dueno, dueno), /TransicionInvalida/);
  });

  it("C10 baja condicionada: no se elimina una tarea que no está Hecha", async () => {
    await fallaCon(c.cerrarTarea(program, tablero, 1, dueno), /EstadoNoHecha/);
  });

  it("C11 solo el dueño elimina tareas", async () => {
    await fallaCon(c.cerrarTarea(como(colab), tablero, 0, colab.publicKey), /NoAutorizado/);
  });

  it("C12 elimina la tarea Hecha: cuenta cerrada, renta al dueño, contador baja", async () => {
    const antes = await provider.connection.getBalance(dueno);
    await c.cerrarTarea(program, tablero, 0, dueno);
    expect(await c.leerTarea(program, c.tareaPda(tablero, 0))).to.be.null;
    expect(await provider.connection.getBalance(dueno)).to.be.greaterThan(antes);
    expect((await c.leerTablero(program, tablero))!.tareasAbiertas).to.eq(1);
  });

  it("C13 baja condicionada: el tablero no se cierra con tareas", async () => {
    await fallaCon(c.cerrarTablero(program, tablero, dueno), /TableroConTareas/);
  });

  it("C14 el tablero se cierra solo por su dueño y sin tareas", async () => {
    await c.avanzarTarea(como(colab), tablero, 1, colab.publicKey);
    await c.avanzarTarea(como(colab), tablero, 1, colab.publicKey);
    await c.cerrarTarea(program, tablero, 1, dueno);
    await fallaCon(c.cerrarTablero(como(intruso), tablero, intruso.publicKey), /NoAutorizado/);
    await c.cerrarTablero(program, tablero, dueno);
    expect(await c.leerTablero(program, tablero)).to.be.null;
  });
});
