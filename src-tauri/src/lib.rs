//! Native UCI process host. No synthetic metrics are ever emitted.
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{Emitter, Manager};

const BUNDLED: &str = "__bundled__";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize, Clone)]
struct UciLine {
    slot: String,
    line: String,
}
struct RunningEngine {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
}
#[derive(Default)]
struct EngineState {
    engines: Mutex<HashMap<String, RunningEngine>>,
}
impl Drop for EngineState {
    fn drop(&mut self) {
        if let Ok(engines) = self.engines.get_mut() {
            for (_, mut engine) in engines.drain() {
                let _ = engine.child.kill();
                let _ = engine.child.wait();
            }
        }
    }
}

fn engine_path(app: &tauri::AppHandle, input: &str) -> Result<PathBuf, String> {
    if input == BUNDLED {
        app.path()
            .resolve("stockfish/stockfish.exe", tauri::path::BaseDirectory::Resource)
            .map_err(|e| format!("Cannot locate bundled Stockfish: {e}"))
    } else {
        let path = PathBuf::from(input);
        if !path.is_absolute() {
            return Err("Choose an absolute executable path".into());
        }
        Ok(path)
    }
}
fn assert_slot(slot: &str) -> Result<(), String> {
    if slot == "white" || slot == "black" || slot == "inspect" { Ok(()) }
    else { Err("Engine slot must be white, black or inspect".into()) }
}

#[tauri::command]
fn bundled_engine_available(app: tauri::AppHandle) -> bool {
    engine_path(&app, BUNDLED).map(|p| p.is_file()).unwrap_or(false)
}

#[tauri::command]
fn launch_engine(
    slot: String,
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineState>,
) -> Result<(), String> {
    assert_slot(&slot)?;
    let executable = engine_path(&app, &path)?;
    if !executable.is_file() {
        return Err(format!("Engine missing: {}", executable.display()));
    }
    stop_impl(&state, &slot)?;
    let mut command = Command::new(&executable);
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|e| format!("Could not start {}: {e}", executable.display()))?;
    let stdin = child.stdin.take().ok_or("Engine stdin missing")?;
    let stdout = child.stdout.take().ok_or("Engine stdout missing")?;
    let stderr = child.stderr.take().ok_or("Engine stderr missing")?;
    let writer = Arc::new(Mutex::new(stdin));
    state.engines.lock().map_err(|e| e.to_string())?
        .insert(slot.clone(), RunningEngine { child, stdin: writer });

    let out_app = app.clone();
    let out_slot = slot.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => { let _ = out_app.emit("uci-line", UciLine { slot: out_slot.clone(), line }); }
                Err(_) => break,
            }
        }
        let _ = out_app.emit("uci-closed", out_slot);
    });
    let err_app = app.clone();
    let err_slot = slot.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().take(1000) {
            if let Ok(line) = line {
                let _ = err_app.emit("uci-stderr", UciLine { slot: err_slot.clone(), line });
            } else { break; }
        }
    });
    send_impl(&state, &slot, "uci")?;
    Ok(())
}
// Kept as a separate function for unit-level validation of UCI inputs.
fn send_impl(state: &EngineState, slot: &str, command: &str) -> Result<(), String> {
    assert_slot(slot)?;
    if command.contains('\n') || command.contains('\r') || command.len() > 4096 {
        return Err("Only one bounded UCI command per request is allowed".into());
    }
    let writer = {
        let engines = state.engines.lock().map_err(|e| e.to_string())?;
        engines.get(slot).ok_or_else(|| format!("{slot} engine not launched"))?.stdin.clone()
    };
    let mut stream = writer.lock().map_err(|e| e.to_string())?;
    writeln!(stream, "{command}").map_err(|e| format!("UCI write failed: {e}"))?;
    stream.flush().map_err(|e| e.to_string())
}
#[tauri::command]
fn send_uci(slot: String, command: String, state: tauri::State<'_, EngineState>) -> Result<(), String> {
    send_impl(&state, &slot, &command)
}
fn stop_impl(state: &EngineState, slot: &str) -> Result<(), String> {
    assert_slot(slot)?;
    let running = state.engines.lock().map_err(|e| e.to_string())?.remove(slot);
    if let Some(mut process) = running {
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
    Ok(())
}
#[tauri::command]
fn stop_engine(slot: String, state: tauri::State<'_, EngineState>) -> Result<(), String> {
    stop_impl(&state, &slot)
}

// Tournament opening books are read sequentially, so large multi-million-FEN
// .epd files never have to be loaded into the webview or native process memory.
const MAX_EPD_RESERVOIR: usize = 4096;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EpdBookSample {
    path: String,
    file_name: String,
    total_lines: u64,
    candidate_lines: u64,
    positions: Vec<String>,
}

fn parse_epd_fen(line: &str) -> Option<String> {
    let line = line.trim_start_matches('\u{feff}').trim();
    if line.is_empty() || line.starts_with('#') || line.starts_with('%') || line.starts_with("//") {
        return None;
    }
    let fields: Vec<&str> = line.split_whitespace().take(6).collect();
    if fields.len() < 4 {
        return None;
    }
    let board = fields[0];
    let ranks: Vec<&str> = board.split('/').collect();
    if ranks.len() != 8 {
        return None;
    }
    for rank in ranks {
        let mut squares = 0usize;
        for c in rank.chars() {
            match c {
                '1'..='8' => squares += c.to_digit(10)? as usize,
                'p' | 'r' | 'n' | 'b' | 'q' | 'k' |
                'P' | 'R' | 'N' | 'B' | 'Q' | 'K' => squares += 1,
                _ => return None,
            }
        }
        if squares != 8 {
            return None;
        }
    }
    let side = fields[1];
    if side != "w" && side != "b" {
        return None;
    }
    let castling = fields[2];
    if castling != "-" && (castling.len() > 4 || castling.is_empty()
        || !castling.chars().all(|c| "KQkq".contains(c))) {
        return None;
    }
    let ep = fields[3];
    if ep != "-" {
        let bytes = ep.as_bytes();
        if bytes.len() != 2 || !(b'a'..=b'h').contains(&bytes[0])
            || bytes[1] != (if side == "w" { b'6' } else { b'3' }) {
            return None;
        }
    }
    // EPD is four FEN fields followed by optional opcodes; 6-field FEN is
    // also accepted when the next two fields are numeric move counters.
    let halfmove = fields.get(4).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let fullmove = fields.get(5).and_then(|s| s.parse::<u32>().ok()).unwrap_or(1).max(1);
    Some(format!("{board} {side} {castling} {ep} {halfmove} {fullmove}"))
}

#[tauri::command]
fn load_epd_book(path: String) -> Result<EpdBookSample, String> {
    use rand::Rng;

    let book_path = PathBuf::from(&path);
    if !book_path.is_absolute() || !book_path.is_file() {
        return Err("Choose an existing absolute .epd file path".into());
    }
    if !book_path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("epd")) {
        return Err("Only .epd opening book files are supported".into());
    }
    let file = std::fs::File::open(&book_path)
        .map_err(|e| format!("Unable to open EPD book: {e}"))?;
    let mut sampler = rand::thread_rng();
    let mut total_lines = 0u64;
    let mut candidate_lines = 0u64;
    let mut positions = Vec::with_capacity(MAX_EPD_RESERVOIR);
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|e| format!("Error while reading EPD book: {e}"))?;
        total_lines += 1;
        if line.len() > 4096 {
            continue;
        }
        if let Some(fen) = parse_epd_fen(&line) {
            candidate_lines += 1;
            if positions.len() < MAX_EPD_RESERVOIR {
                positions.push(fen);
            } else {
                // Uniform reservoir across the entire file, not just its first lines.
                let pick = sampler.gen_range(0..candidate_lines);
                if pick < MAX_EPD_RESERVOIR as u64 {
                    positions[pick as usize] = fen;
                }
            }
        }
    }
    Ok(EpdBookSample {
        file_name: book_path.file_name().and_then(|name| name.to_str()).unwrap_or("opening.epd").to_string(),
        path, total_lines, candidate_lines, positions,
    })
}

#[cfg(test)]
mod epd_tests {
    use super::parse_epd_fen;
    #[test]
    fn standard_epd_ignores_opcode_suffix() {
        assert_eq!(
            parse_epd_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - bm e4; id \"start\";"),
            Some("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".into())
        );
    }
    #[test]
    fn fen_six_fields_and_invalid_epd() {
        assert_eq!(
            parse_epd_fen("8/8/8/8/8/8/4k3/4K3 b - - 10 23"),
            Some("8/8/8/8/8/8/4k3/4K3 b - - 10 23".into())
        );
        assert!(parse_epd_fen("8/8/8 w - -").is_none());
        assert!(parse_epd_fen("# comment").is_none());
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(EngineState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            bundled_engine_available, launch_engine, send_uci, stop_engine, load_epd_book
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Chess X-Ray");
}
