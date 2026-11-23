"""Genera src/idl/tareas.json (formato IDL de Anchor 0.30+).
Discriminadores: sha256("global:<ix>")[:8] y sha256("account:<Cuenta>")[:8].
Tras `anchor build` puedes usar target/idl/tareas.json en su lugar (misma forma).
Si cambias el Program ID: edita PID aquí o pásalo como argumento."""
import hashlib, json, pathlib, sys

PID = sys.argv[1] if len(sys.argv) > 1 else "EEuQpJC3tm46dGDMURusEsSdLwhQXtAPRHTmTCiHvr7f"
SYS = "11111111111111111111111111111111"
disc = lambda p: list(hashlib.sha256(p.encode()).digest()[:8])

def a(name, w=False, s=False, addr=None):
    d = {"name": name}
    if w: d["writable"] = True
    if s: d["signer"] = True
    if addr: d["address"] = addr
    return d

sysp = a("system_program", addr=SYS)
ix = lambda n, accs, args=(): {"name": n, "discriminator": disc("global:" + n),
                               "accounts": accs, "args": [{"name": x, "type": t} for x, t in args]}

instructions = [
    ix("crear_tablero", [a("tablero", w=True), a("authority", w=True, s=True), sysp], [("nombre", "string")]),
    ix("crear_tarea", [a("tablero", w=True), a("tarea", w=True), a("authority", w=True, s=True), sysp],
       [("id", "u32"), ("titulo", "string"), ("prioridad", "u8"), ("asignado", "pubkey")]),
    ix("reasignar_tarea", [a("tablero"), a("tarea", w=True), a("authority", s=True)], [("nuevo", "pubkey")]),
    ix("avanzar_tarea", [a("tablero"), a("tarea", w=True), a("firmante", s=True)]),
    ix("cerrar_tarea", [a("tablero", w=True), a("tarea", w=True), a("authority", w=True, s=True)]),
    ix("cerrar_tablero", [a("tablero", w=True), a("authority", w=True, s=True)]),
]

f = lambda n, t: {"name": n, "type": t}
types = [
    {"name": "Tablero", "type": {"kind": "struct", "fields": [
        f("authority", "pubkey"), f("nombre", "string"), f("siguiente_id", "u32"),
        f("tareas_abiertas", "u16"), f("bump", "u8")]}},
    {"name": "Tarea", "type": {"kind": "struct", "fields": [
        f("tablero", "pubkey"), f("id", "u32"), f("titulo", "string"), f("asignado", "pubkey"),
        f("prioridad", "u8"), f("estado", {"defined": {"name": "EstadoTarea"}}),
        f("creada_en", "i64"), f("bump", "u8")]}},
    {"name": "EstadoTarea", "type": {"kind": "enum", "variants": [
        {"name": "Pendiente"}, {"name": "EnCurso"}, {"name": "Hecha"}]}},
]

errs = [("NombreInvalido", "Nombre vacío o de más de 32 bytes"),
        ("TituloInvalido", "Título vacío o de más de 64 bytes"),
        ("PrioridadInvalida", "Prioridad inválida (1 = alta, 2 = media, 3 = baja)"),
        ("IdInvalido", "El id no es el siguiente del tablero"),
        ("NoAutorizado", "No tienes permiso para esta operación"),
        ("TransicionInvalida", "Transición de estado no permitida"),
        ("EstadoNoHecha", "Solo se puede eliminar una tarea hecha"),
        ("TableroConTareas", "El tablero aún tiene tareas; elimínalas antes"),
        ("Desbordamiento", "Desbordamiento aritmético")]

idl = {
    "address": PID,
    "metadata": {"name": "tareas", "version": "0.1.0", "spec": "0.1.0",
                 "description": "Tablero de tareas con asignación y cierre condicionado"},
    "instructions": instructions,
    "accounts": [{"name": n, "discriminator": disc("account:" + n)} for n in ("Tablero", "Tarea")],
    "errors": [{"code": 6000 + i, "name": n, "msg": m} for i, (n, m) in enumerate(errs)],
    "types": types,
}
out = pathlib.Path(__file__).resolve().parent.parent / "src/idl/tareas.json"
out.write_text(json.dumps(idl, indent=2, ensure_ascii=False) + "\n")
print("escrito", out, "| program id:", PID)
