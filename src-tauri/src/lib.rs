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
    if slot == "white" || slot == "black" { Ok(()) }
    else { Err("Engine slot must be white or black".into()) }
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
pub fn run() {
    tauri::Builder::default()
        .manage(EngineState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            bundled_engine_available, launch_engine, send_uci, stop_engine
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Chess X-Ray");
}
