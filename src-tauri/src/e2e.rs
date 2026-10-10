//! Debug builds only: lets a test run drive the real app without a person clicking.
//! MEDIAMORPH_E2E holds a JSON test plan, MEDIAMORPH_E2E_REPORT the file to write the result to.
//! Release builds do not compile this module, so the page's hook finds no commands and does nothing.

#[tauri::command]
pub fn e2e_config() -> Option<String> {
    std::env::var("MEDIAMORPH_E2E").ok()
}

#[tauri::command]
pub fn e2e_report(report: String) -> Result<(), String> {
    let path = std::env::var("MEDIAMORPH_E2E_REPORT")
        .map_err(|_| "MEDIAMORPH_E2E_REPORT is not set".to_string())?;
    std::fs::write(path, report).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn e2e_exit(app: tauri::AppHandle) {
    app.exit(0);
}
