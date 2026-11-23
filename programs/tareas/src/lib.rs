//! Tablero de tareas.
//!
//! Cuentas:
//!   Tablero PDA ["tablero", authority, nombre]  -> lo crea y administra su dueño
//!   Tarea   PDA ["tarea", tablero, id_le_bytes] -> la crea el dueño; id = tablero.siguiente_id
//!
//! Reparto de permisos (la parte central del diseño):
//!   - el DUEÑO crea, reasigna y elimina tareas, y cierra el tablero;
//!   - el ASIGNADO es el único que mueve su tarea (Pendiente -> EnCurso -> Hecha);
//!   - nadie más puede tocar nada.
//! Reglas de cierre: una tarea solo se elimina si está Hecha; el tablero solo si no tiene tareas.
use anchor_lang::prelude::*;

declare_id!("EEuQpJC3tm46dGDMURusEsSdLwhQXtAPRHTmTCiHvr7f");

pub const MAX_NOMBRE: usize = 32; // límite de una semilla PDA
pub const MAX_TITULO: usize = 64;

#[program]
pub mod tareas {
    use super::*;

    /// CREAR (cuenta raíz).
    pub fn crear_tablero(ctx: Context<CrearTablero>, nombre: String) -> Result<()> {
        require!(
            !nombre.is_empty() && nombre.len() <= MAX_NOMBRE,
            TareasError::NombreInvalido
        );
        let t = &mut ctx.accounts.tablero;
        t.authority = ctx.accounts.authority.key();
        t.nombre = nombre;
        t.siguiente_id = 0;
        t.tareas_abiertas = 0;
        t.bump = ctx.bumps.tablero;
        Ok(())
    }

    /// CREAR (cuenta relacionada). Solo el dueño; el id debe ser el siguiente del tablero.
    pub fn crear_tarea(
        ctx: Context<CrearTarea>,
        id: u32,
        titulo: String,
        prioridad: u8,
        asignado: Pubkey,
    ) -> Result<()> {
        require!(
            !titulo.is_empty() && titulo.len() <= MAX_TITULO,
            TareasError::TituloInvalido
        );
        require!((1..=3).contains(&prioridad), TareasError::PrioridadInvalida);

        let tablero = &mut ctx.accounts.tablero;
        let tarea = &mut ctx.accounts.tarea;
        tarea.tablero = tablero.key();
        tarea.id = id;
        tarea.titulo = titulo;
        tarea.asignado = asignado;
        tarea.prioridad = prioridad;
        tarea.estado = EstadoTarea::Pendiente;
        tarea.creada_en = Clock::get()?.unix_timestamp;
        tarea.bump = ctx.bumps.tarea;

        tablero.siguiente_id = tablero.siguiente_id.checked_add(1).ok_or(TareasError::Desbordamiento)?;
        tablero.tareas_abiertas = tablero.tareas_abiertas.checked_add(1).ok_or(TareasError::Desbordamiento)?;
        Ok(())
    }

    /// MODIFICAR + PERMISOS: solo el dueño reasigna, y no una tarea ya Hecha.
    pub fn reasignar_tarea(ctx: Context<ReasignarTarea>, nuevo: Pubkey) -> Result<()> {
        let tarea = &mut ctx.accounts.tarea;
        require!(tarea.estado != EstadoTarea::Hecha, TareasError::TransicionInvalida);
        tarea.asignado = nuevo;
        Ok(())
    }

    /// MODIFICAR + PERMISOS: solo el asignado avanza; el estado solo va hacia adelante.
    pub fn avanzar_tarea(ctx: Context<AvanzarTarea>) -> Result<()> {
        let tarea = &mut ctx.accounts.tarea;
        require!(
            ctx.accounts.firmante.key() == tarea.asignado,
            TareasError::NoAutorizado
        );
        tarea.estado = match tarea.estado {
            EstadoTarea::Pendiente => EstadoTarea::EnCurso,
            EstadoTarea::EnCurso => EstadoTarea::Hecha,
            EstadoTarea::Hecha => return err!(TareasError::TransicionInvalida),
        };
        Ok(())
    }

    /// BAJA CONDICIONADA #1: solo se elimina una tarea Hecha; la renta vuelve al dueño que la pagó.
    pub fn cerrar_tarea(ctx: Context<CerrarTarea>) -> Result<()> {
        let t = &mut ctx.accounts.tablero;
        t.tareas_abiertas = t.tareas_abiertas.checked_sub(1).ok_or(TareasError::Desbordamiento)?;
        Ok(())
    }

    /// BAJA CONDICIONADA #2: el tablero solo se cierra sin tareas (lo valida la constraint).
    pub fn cerrar_tablero(_ctx: Context<CerrarTableroCtx>) -> Result<()> {
        Ok(())
    }
}

// ───────────────────────── Cuentas de datos ─────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Tablero {
    pub authority: Pubkey,
    #[max_len(MAX_NOMBRE)]
    pub nombre: String,
    /// Id que tendrá la próxima tarea (sirve como semilla única).
    pub siguiente_id: u32,
    /// Cuentas Tarea existentes. Habilita la regla de cerrar_tablero.
    pub tareas_abiertas: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Tarea {
    pub tablero: Pubkey, // primer campo: offset 8, filtrable con memcmp
    pub id: u32,
    #[max_len(MAX_TITULO)]
    pub titulo: String,
    pub asignado: Pubkey,
    pub prioridad: u8,
    pub estado: EstadoTarea,
    pub creada_en: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EstadoTarea {
    Pendiente,
    EnCurso,
    Hecha,
}

// ───────────────────────── Contextos ─────────────────────────

#[derive(Accounts)]
#[instruction(nombre: String)]
pub struct CrearTablero<'info> {
    #[account(
        init, payer = authority, space = 8 + Tablero::INIT_SPACE,
        seeds = [b"tablero", authority.key().as_ref(), nombre.as_bytes()], bump
    )]
    pub tablero: Account<'info, Tablero>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct CrearTarea<'info> {
    #[account(
        mut,
        has_one = authority @ TareasError::NoAutorizado,
        constraint = id == tablero.siguiente_id @ TareasError::IdInvalido
    )]
    pub tablero: Account<'info, Tablero>,
    #[account(
        init, payer = authority, space = 8 + Tarea::INIT_SPACE,
        seeds = [b"tarea", tablero.key().as_ref(), &id.to_le_bytes()], bump
    )]
    pub tarea: Account<'info, Tarea>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReasignarTarea<'info> {
    #[account(has_one = authority @ TareasError::NoAutorizado)]
    pub tablero: Account<'info, Tablero>,
    #[account(
        mut, has_one = tablero,
        seeds = [b"tarea", tablero.key().as_ref(), &tarea.id.to_le_bytes()], bump = tarea.bump
    )]
    pub tarea: Account<'info, Tarea>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AvanzarTarea<'info> {
    pub tablero: Account<'info, Tablero>,
    #[account(
        mut, has_one = tablero,
        seeds = [b"tarea", tablero.key().as_ref(), &tarea.id.to_le_bytes()], bump = tarea.bump
    )]
    pub tarea: Account<'info, Tarea>,
    pub firmante: Signer<'info>,
}

#[derive(Accounts)]
pub struct CerrarTarea<'info> {
    #[account(mut, has_one = authority @ TareasError::NoAutorizado)]
    pub tablero: Account<'info, Tablero>,
    #[account(
        mut, close = authority, has_one = tablero,
        seeds = [b"tarea", tablero.key().as_ref(), &tarea.id.to_le_bytes()], bump = tarea.bump,
        constraint = tarea.estado == EstadoTarea::Hecha @ TareasError::EstadoNoHecha
    )]
    pub tarea: Account<'info, Tarea>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CerrarTableroCtx<'info> {
    #[account(
        mut, close = authority,
        has_one = authority @ TareasError::NoAutorizado,
        constraint = tablero.tareas_abiertas == 0 @ TareasError::TableroConTareas
    )]
    pub tablero: Account<'info, Tablero>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

// ───────────────────────── Errores ─────────────────────────

#[error_code]
pub enum TareasError {
    #[msg("Nombre vacío o de más de 32 bytes")]
    NombreInvalido,
    #[msg("Título vacío o de más de 64 bytes")]
    TituloInvalido,
    #[msg("Prioridad inválida (1 = alta, 2 = media, 3 = baja)")]
    PrioridadInvalida,
    #[msg("El id no es el siguiente del tablero")]
    IdInvalido,
    #[msg("No tienes permiso para esta operación")]
    NoAutorizado,
    #[msg("Transición de estado no permitida")]
    TransicionInvalida,
    #[msg("Solo se puede eliminar una tarea hecha")]
    EstadoNoHecha,
    #[msg("El tablero aún tiene tareas; elimínalas antes")]
    TableroConTareas,
    #[msg("Desbordamiento aritmético")]
    Desbordamiento,
}
