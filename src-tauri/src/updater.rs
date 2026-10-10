//! Keeps Mediamorph up to date. Once a week it asks GitHub for the latest release. A release build
//! somewhere it can write downloads the update, checks it is signed exactly as itself, and puts it
//! in place as Mediamorph quits, so nothing is ever interrupted and the next start is the new
//! version, which says so for a moment in the title bar. A copy that cannot update itself names the
//! new version in its menu, and a release build opened straight from the unzipped download is
//! offered a move to Applications, from where it can.

use crate::update::{self, NewRelease, Route};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const LATEST: &str = "https://api.github.com/repos/FaizanAshiq/mediamorph/releases/latest";
/// Where updates come from instead of GitHub: a folder holding `latest.json`, shaped as GitHub's
/// answer, so the end-to-end test can update to a build of its own.
const FEED: &str = "MEDIAMORPH_UPDATE_FEED";
/// Seconds after a start to the first check whether a look is due.
const FIRST: u64 = 10;

#[derive(Default)]
pub struct Updates(Mutex<State>);

#[derive(Default)]
struct State {
    /// Downloaded, unpacked and checked, with the bundle it replaces as Mediamorph quits.
    ready: Option<(PathBuf, PathBuf)>,
    /// The newer version, when this copy does not install it itself, for the menu.
    available: Option<String>,
}

/// This copy: its bundle, its version, and how it gets a newer one.
struct Copy {
    app: PathBuf,
    version: String,
    route: Route,
}

/// None when not run from an app bundle, as under `tauri dev`.
fn this_copy() -> Option<Copy> {
    // Mediamorph.app/Contents/MacOS/mediamorph
    let app = std::env::current_exe().ok()?.ancestors().nth(3)?.to_path_buf();
    if app.extension()? != "app" {
        return None;
    }
    let version = update::bundle_version(&std::fs::read_to_string(app.join("Contents/Info.plist")).ok()?)?;
    let signed = output("/usr/bin/codesign", &["-dvv", &app.to_string_lossy()]).contains("Authority=Tinysnap Release");
    let writable = [app.parent(), Some(app.as_path())].into_iter().flatten().all(|path| run("/bin/test", &["-w", &path.to_string_lossy()]));
    let route = Route::of(&app.to_string_lossy(), signed, writable);
    Some(Copy { app, version, route })
}

pub fn start(app: &AppHandle) {
    let Some(copy) = this_copy() else { return };
    if copy.route == Route::Move {
        offer_move(app, &copy);
    }
    let app = app.clone();
    std::thread::spawn(move || keep_looking(app, copy));
}

/// Waits, an hour at most at a time, for a week to pass since the last look, then looks.
fn keep_looking(app: AppHandle, copy: Copy) {
    let stamp = config_file(&app, "last-update-check");
    // A download put aside and never put in place, as when Mediamorph ended without quitting:
    // look again at once rather than a week on.
    let left = staging(&app).is_some_and(|folder| folder.join("Mediamorph.app").exists());
    let mut last = if left { 0 } else { stamp.as_ref().and_then(|path| std::fs::read_to_string(path).ok()).and_then(|text| text.trim().parse().ok()).unwrap_or(0) };
    std::thread::sleep(Duration::from_secs(FIRST));
    loop {
        let wait = update::wait(last, now());
        if wait > 0 {
            std::thread::sleep(Duration::from_secs(wait));
            continue;
        }
        last = now();
        if let Some(path) = &stamp {
            let _ = std::fs::write(path, last.to_string());
        }
        look(&app, &copy);
    }
}

fn look(app: &AppHandle, copy: &Copy) {
    let feed = std::env::var_os(FEED).map(PathBuf::from);
    let answer = match &feed {
        Some(folder) => std::fs::read_to_string(folder.join("latest.json")).ok(),
        None => Some(output("/usr/bin/curl", &["-fsSL", "--max-time", "30", "-H", "User-Agent: Mediamorph", LATEST])),
    };
    // Offline, or GitHub refusing: the next look tries again.
    let Some(release) = answer.and_then(|answer| NewRelease::newer(&answer, &copy.version)) else { return };
    if copy.route == Route::Itself {
        if let Some(staged) = release.download.as_deref().and_then(|url| prepare(app, url, feed.is_some(), &copy.app)) {
            app.state::<Updates>().0.lock().unwrap().ready = Some((staged, copy.app.clone()));
            return;
        }
    }
    app.state::<Updates>().0.lock().unwrap().available = Some(release.version);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Ok(menu) = crate::mac_menu(&handle) {
            let _ = handle.set_menu(menu);
        }
    });
}

/// The update downloaded and unpacked, when it is signed exactly as this copy; None otherwise.
fn prepare(app: &AppHandle, url: &str, test_feed: bool, own: &Path) -> Option<PathBuf> {
    let staging = staging(app)?;
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).ok()?;
    let zip = match url.strip_prefix("file://") {
        // A test feed's zip is a file already; GitHub's answer only addresses on the web.
        Some(path) if test_feed => PathBuf::from(path),
        Some(_) => return None,
        None => {
            let zip = staging.join(update::ASSET);
            run("/usr/bin/curl", &["-fsSL", "--max-time", "900", "-o", &zip.to_string_lossy(), url]).then_some(zip)?
        }
    };
    let unpacked = run("/usr/bin/ditto", &["-x", "-k", &zip.to_string_lossy(), &staging.to_string_lossy()]);
    let _ = std::fs::remove_file(staging.join(update::ASSET));
    let staged = staging.join("Mediamorph.app");
    if unpacked && signed_as(own, &staged) {
        return Some(staged);
    }
    let _ = std::fs::remove_dir_all(&staging);
    None
}

/// True when `other` meets `own`'s designated requirement: signed exactly as this copy is, so
/// nothing but a release build replaces a release build.
fn signed_as(own: &Path, other: &Path) -> bool {
    let printed = output("/usr/bin/codesign", &["-d", "-r-", &own.to_string_lossy()]);
    let Some(requirement) = printed.lines().find_map(|line| line.strip_prefix("designated => ")) else { return false };
    run("/usr/bin/codesign", &["--verify", "--deep", "--strict", &format!("-R={requirement}"), &other.to_string_lossy()])
}

/// As Mediamorph quits: a downloaded update takes this copy's place once it has ended. The next
/// start is the new version, which says so.
pub fn install_on_exit(app: &AppHandle) {
    let Some((staged, own)) = app.state::<Updates>().0.lock().unwrap().ready.take() else { return };
    let version = std::fs::read_to_string(staged.join("Contents/Info.plist")).ok().and_then(|plist| update::bundle_version(&plist));
    if let (Some(marker), Some(version)) = (config_file(app, "updated-to"), version) {
        let _ = std::fs::write(marker, version);
    }
    let swap = r#"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
rm -rf "$2.replaced"
if mv "$2" "$2.replaced"; then
    if mv "$3" "$2"; then rm -rf "$2.replaced"; else mv "$2.replaced" "$2"; fi
fi"#;
    launch(swap, &[&own.to_string_lossy(), &staged.to_string_lossy()]);
}

/// The version this start was updated to, once, for the title bar.
#[tauri::command]
pub fn update_note(app: AppHandle) -> Option<String> {
    let marker = config_file(&app, "updated-to")?;
    let version = std::fs::read_to_string(&marker).ok()?;
    let _ = std::fs::remove_file(&marker);
    let copy = this_copy()?;
    (version.trim() == copy.version).then_some(copy.version)
}

/// The newer version this copy does not install itself, for the menu.
pub fn available(app: &AppHandle) -> Option<String> {
    app.state::<Updates>().0.lock().unwrap().available.clone()
}

/// The new version's release page, to download it from.
pub fn open_download(app: &AppHandle) {
    if let Some(version) = available(app) {
        let _ = Command::new("/usr/bin/open").arg(format!("https://github.com/FaizanAshiq/mediamorph/releases/tag/v{version}")).spawn();
    }
}

/// Opened from the unzipped download in Downloads, macOS lets the app change nothing where it is,
/// so it could never update. Copied to Applications, it can.
fn offer_move(app: &AppHandle, copy: &Copy) {
    let from = copy.app.clone();
    let handle = app.clone();
    app.dialog()
        .message("It is running from Downloads, where it cannot keep itself up to date. From Applications it can.")
        .title("Move Mediamorph to Applications?")
        .buttons(MessageDialogButtons::OkCancelCustom("Move to Applications".into(), "Not Now".into()))
        .show(move |moving| {
            if moving {
                move_to_applications(&handle, &from);
            }
        });
}

fn move_to_applications(app: &AppHandle, from: &Path) {
    let destination = Path::new(update::APPLICATIONS);
    // An earlier copy goes to the Bin, where it can still be had back.
    let cleared = !destination.exists() || trash::delete(destination).is_ok();
    if cleared && run("/usr/bin/ditto", &[&from.to_string_lossy(), update::APPLICATIONS]) {
        // Already opened once, as the person allowed; without the mark the copy runs where it is
        // rather than from another hidden copy.
        let _ = run("/usr/bin/xattr", &["-dr", "com.apple.quarantine", update::APPLICATIONS]);
        if launch(r#"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; open "$2""#, &[update::APPLICATIONS]) {
            app.exit(0);
        }
        return;
    }
    app.dialog()
        .message("Drag it from Downloads into Applications, then open it from there.")
        .title("Mediamorph could not move itself")
        .show(|_| {});
}

fn config_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let folder = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&folder).ok()?;
    Some(folder.join(name))
}

fn staging(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_cache_dir().ok()?.join("Update"))
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.as_secs())
}

fn run(tool: &str, arguments: &[&str]) -> bool {
    Command::new(tool).args(arguments).output().is_ok_and(|done| done.status.success())
}

/// What a tool printed, both streams, or nothing when it did not run.
fn output(tool: &str, arguments: &[&str]) -> String {
    Command::new(tool)
        .args(arguments)
        .output()
        .map(|done| format!("{}{}", String::from_utf8_lossy(&done.stdout), String::from_utf8_lossy(&done.stderr)))
        .unwrap_or_default()
}

/// Starts `script` with this process's id as `$1` and `arguments` after it, to carry on once
/// Mediamorph has quit.
fn launch(script: &str, arguments: &[&str]) -> bool {
    Command::new("/bin/sh").arg("-c").arg(script).arg("sh").arg(std::process::id().to_string()).args(arguments).spawn().is_ok()
}
