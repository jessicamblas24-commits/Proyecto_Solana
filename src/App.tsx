import { useCallback, useEffect, useMemo, useState } from "react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import * as c from "./lib/client";

type Entrada = { ok: boolean; texto: string; sig?: string };

const RPC: string = (import.meta as any).env?.VITE_RPC ?? "https://api.devnet.solana.com";
const corto = (k: PublicKey) => k.toBase58().slice(0, 4) + "…" + k.toBase58().slice(-4);
const PRIORIDAD = ["", "Alta", "Media", "Baja"];
const COLUMNAS: { estado: c.Estado; titulo: string }[] = [
  { estado: "pendiente", titulo: "Pendientes" },
  { estado: "enCurso", titulo: "En curso" },
  { estado: "hecha", titulo: "Hechas" },
];

const parseKey = (s: string): PublicKey | null => {
  try { return new PublicKey(s); } catch { return null; }
};

export default function App() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const yo = wallet?.publicKey;

  const [nombre, setNombre] = useState("mi-tablero");
  const [duenoTxt, setDuenoTxt] = useState("");
  const [titulo, setTitulo] = useState("");
  const [prioridad, setPrioridad] = useState(2);
  const [asignadoTxt, setAsignadoTxt] = useState("");
  const [tablero, setTablero] = useState<c.TableroData | null>(null);
  const [tareas, setTareas] = useState<c.TareaFila[]>([]);
  const [log, setLog] = useState<Entrada[]>([]);
  const [busy, setBusy] = useState(false);
  const [forzar, setForzar] = useState(false);

  const program = useMemo(
    () => (wallet ? c.getProgram(new AnchorProvider(connection, wallet, { commitment: "confirmed" })) : null),
    [connection, wallet]
  );

  const duenoKey = useMemo(() => (duenoTxt ? parseKey(duenoTxt) : yo ?? null), [duenoTxt, yo]);
  const tableroKey = duenoKey && nombre ? c.tableroPda(duenoKey, nombre) : null;
  const soyDueno = !!(yo && tablero && tablero.authority.equals(yo));
  const asignadoKey = (asignadoTxt ? parseKey(asignadoTxt) : yo) ?? null;

  const refrescar = useCallback(async () => {
    if (!program || !tableroKey) { setTablero(null); setTareas([]); return; }
    const t = await c.leerTablero(program, tableroKey);
    setTablero(t);
    setTareas(t ? await c.listarTareas(program, tableroKey) : []);
  }, [program, tableroKey]);

  useEffect(() => { refrescar().catch(() => {}); }, [refrescar]);

  const ejecutar = async (etiqueta: string, fn: () => Promise<string>) => {
    setBusy(true);
    try {
      const sig = await fn();
      setLog((l) => [{ ok: true, texto: etiqueta, sig }, ...l]);
      await refrescar();
    } catch (e) {
      setLog((l) => [{ ok: false, texto: `${etiqueta}: ${c.mensajeError(e)}` }, ...l]);
    } finally { setBusy(false); }
  };

  const enlace = (sig: string) =>
    RPC.includes("devnet")
      ? `https://explorer.solana.com/tx/${sig}?cluster=devnet`
      : `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(RPC)}`;

  return (
    <main>
      <header>
        <h1>Tablero de tareas</h1>
        <WalletMultiButton />
      </header>

      {!wallet && <p className="aviso">Conecta una wallet (en Devnet) para crear un tablero o trabajar en uno.</p>}

      <section className="barra">
        <label>Tablero<input value={nombre} maxLength={32} onChange={(e) => setNombre(e.target.value)} /></label>
        <label className="ancha">Dueño del tablero (vacío = tu wallet)
          <input value={duenoTxt} placeholder={yo?.toBase58() ?? ""} onChange={(e) => setDuenoTxt(e.target.value.trim())} />
        </label>
        <button disabled={!program || !!tablero || busy}
          onClick={() => ejecutar("Crear tablero", () => c.crearTablero(program!, yo!, nombre))}>
          Crear tablero
        </button>
      </section>

      {tableroKey && (
        <p className="meta">
          Cuenta del tablero: <code>{tableroKey.toBase58()}</code>
          {tablero ? ` · ${tablero.tareasAbiertas} tareas` : " · aún no existe"}
        </p>
      )}

      {tablero && (
        <>
          <section className="barra">
            <label className="ancha">Nueva tarea
              <input value={titulo} maxLength={64} onChange={(e) => setTitulo(e.target.value)} placeholder="Qué hay que hacer" />
            </label>
            <label>Prioridad
              <select value={prioridad} onChange={(e) => setPrioridad(+e.target.value)}>
                <option value={1}>Alta</option><option value={2}>Media</option><option value={3}>Baja</option>
              </select>
            </label>
            <label className="ancha">Asignar a (vacío = tú)
              <input value={asignadoTxt} placeholder={yo?.toBase58() ?? ""} onChange={(e) => setAsignadoTxt(e.target.value.trim())} />
            </label>
            <button disabled={(!soyDueno && !forzar) || !titulo || !asignadoKey || busy}
              onClick={() => ejecutar("Crear tarea", () =>
                c.crearTarea(program!, tableroKey!, yo!, tablero.siguienteId, titulo, prioridad, asignadoKey!)
                  .then((s) => { setTitulo(""); return s; }))}>
              Añadir tarea
            </button>
          </section>

          <section className="barra">
            <label className="check">
              <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} />
              Enviar aunque la interfaz lo bloquee (para ver el rechazo del programa)
            </label>
            <button className="peligro"
              disabled={((!soyDueno || tablero.tareasAbiertas > 0) && !forzar) || busy}
              title={tablero.tareasAbiertas > 0 ? "Primero elimina las tareas" : ""}
              onClick={() => ejecutar("Eliminar tablero", () => c.cerrarTablero(program!, tableroKey!, yo!))}>
              Eliminar tablero
            </button>
          </section>

          <div className="columnas">
            {COLUMNAS.map(({ estado, titulo: tituloCol }) => (
              <section key={estado} className={`col ${estado}`}>
                <h2>{tituloCol} <span>{tareas.filter((t) => c.estadoDe(t.account) === estado).length}</span></h2>
                {tareas.filter((t) => c.estadoDe(t.account) === estado).map(({ account: t }) => {
                  const mia = !!yo && t.asignado.equals(yo);
                  return (
                    <article key={t.id} className="tarjeta">
                      <h3>{t.titulo}</h3>
                      <p className="detalle">
                        Prioridad {PRIORIDAD[t.prioridad]} · {corto(t.asignado)}{mia ? " (tú)" : ""}
                      </p>
                      <div className="acciones">
                        {estado !== "hecha" && (
                          <button disabled={(!mia && !forzar) || busy}
                            onClick={() => ejecutar(`${estado === "pendiente" ? "Empezar" : "Terminar"} «${t.titulo}»`,
                              () => c.avanzarTarea(program!, tableroKey!, t.id, yo!))}>
                            {estado === "pendiente" ? "Empezar" : "Terminar"}
                          </button>
                        )}
                        <button className="sec"
                          disabled={((!soyDueno || estado === "hecha") && !forzar) || !asignadoKey || busy}
                          title="Usa el campo «Asignar a»"
                          onClick={() => ejecutar(`Reasignar «${t.titulo}»`,
                            () => c.reasignarTarea(program!, tableroKey!, t.id, yo!, asignadoKey!))}>
                          Reasignar
                        </button>
                        <button className="peligro"
                          disabled={((!soyDueno || estado !== "hecha") && !forzar) || busy}
                          title={estado !== "hecha" ? "Solo se elimina una tarea hecha" : ""}
                          onClick={() => ejecutar(`Eliminar «${t.titulo}»`, () => c.cerrarTarea(program!, tableroKey!, t.id, yo!))}>
                          Eliminar
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        </>
      )}

      <section className="registro" aria-live="polite">
        <h2>Registro de operaciones</h2>
        {log.length === 0 && <p className="meta">Aquí verás cada transacción con su firma.</p>}
        <ul>
          {log.map((l, i) => (
            <li key={i} className={l.ok ? "ok" : "error"}>
              {l.ok ? "Hecho: " : "Rechazado: "}{l.texto}
              {l.sig && <> · <a href={enlace(l.sig)} target="_blank" rel="noreferrer">{l.sig.slice(0, 12)}…</a></>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
