//! Whether a newer Mediamorph is out, from GitHub's answer for the latest release, when to ask, and
//! how this copy can get it. Pure, so it is tested without an app around it.

use serde_json::Value;

/// The release file a copy that updates itself downloads.
pub const ASSET: &str = "Mediamorph-mac.zip";
/// Where a copy offered the move goes.
pub const APPLICATIONS: &str = "/Applications/Mediamorph.app";
pub const WEEK: u64 = 7 * 86_400;
pub const HOUR: u64 = 3_600;

/// A release newer than this copy.
#[derive(Debug, PartialEq)]
pub struct NewRelease {
    /// Without its `v`.
    pub version: String,
    /// The app zipped, when the release carries it.
    pub download: Option<String>,
}

impl NewRelease {
    /// The latest release when it is newer than `current`; None when it is not, or the answer
    /// cannot be read, as when GitHub refuses or is down.
    pub fn newer(latest: &str, current: &str) -> Option<NewRelease> {
        let answer: Value = serde_json::from_str(latest).ok()?;
        let tag = answer.get("tag_name")?.as_str()?;
        let version = tag.strip_prefix('v').unwrap_or(tag);
        let (mut newest, mut mine) = (numbers(version)?, numbers(current)?);
        // 1.1 is 1.1.0.
        let length = newest.len().max(mine.len());
        newest.resize(length, 0);
        mine.resize(length, 0);
        if mine >= newest {
            return None;
        }
        let download = answer.get("assets").and_then(Value::as_array).and_then(|assets| {
            let found = assets.iter().find(|each| each.get("name").and_then(Value::as_str) == Some(ASSET))?;
            Some(found.get("browser_download_url")?.as_str()?.to_string())
        });
        Some(NewRelease { version: version.into(), download })
    }
}

/// 1.10.0 as [1, 10, 0], so it sorts after 1.9.2, as text it would not.
fn numbers(version: &str) -> Option<Vec<u64>> {
    version.split('.').map(|part| part.parse().ok()).collect()
}

/// Seconds to wait before checking whether a look is due, zero when it is: one look a week, by the
/// calendar. A timer stops while the Mac sleeps, so one set a week ahead would run late by every
/// night of sleep; the wait is never more than an hour, and each check compares the date with the
/// last look's.
pub fn wait(last_look: u64, now: u64) -> u64 {
    (last_look + WEEK).saturating_sub(now).min(HOUR)
}

/// How this copy gets a newer version, from where it runs and how it was signed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Route {
    /// A release build where it can replace itself: it downloads the update and installs it.
    Itself,
    /// A release build opened straight from the unzipped download, which macOS runs from a hidden
    /// copy no app may write to: offered a move to Applications, from where it updates itself.
    Move,
    /// Built on this Mac, so it cannot tell a release build from anyone else's, or in Applications
    /// where this account may not write: its menu says where to download the new version.
    Download,
}

impl Route {
    pub fn of(path: &str, release_signed: bool, writable: bool) -> Route {
        if !release_signed {
            return Route::Download;
        }
        if writable {
            return Route::Itself;
        }
        if path == APPLICATIONS { Route::Download } else { Route::Move }
    }
}

/// The version an app's Info.plist gives, `CFBundleShortVersionString`.
pub fn bundle_version(plist: &str) -> Option<String> {
    let after = &plist[plist.find("<key>CFBundleShortVersionString</key>")?..];
    let start = after.find("<string>")? + "<string>".len();
    let end = after[start..].find("</string>")?;
    Some(after[start..start + end].trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 86_400;

    fn latest(tag: &str, assets: &[&str]) -> String {
        let list: Vec<String> = assets
            .iter()
            .map(|name| format!(r#"{{"name": "{name}", "browser_download_url": "https://example.com/{name}"}}"#))
            .collect();
        format!(r#"{{"tag_name": "{tag}", "name": "Mediamorph", "assets": [{}]}}"#, list.join(","))
    }

    #[test]
    fn a_newer_release_is_found_without_its_v_and_with_the_app() {
        let release = NewRelease::newer(&latest("v1.1.0", &["Mediamorph-mac.dmg", ASSET]), "1.0.0");
        assert_eq!(release, Some(NewRelease { version: "1.1.0".into(), download: Some(format!("https://example.com/{ASSET}")) }));
    }

    #[test]
    fn a_release_without_the_app_is_still_found() {
        assert_eq!(NewRelease::newer(&latest("v1.1.0", &[]), "1.0.0"), Some(NewRelease { version: "1.1.0".into(), download: None }));
    }

    #[test]
    fn the_same_or_an_older_release_is_not() {
        assert_eq!(NewRelease::newer(&latest("v1.0.0", &[]), "1.0.0"), None);
        assert_eq!(NewRelease::newer(&latest("v0.9.0", &[]), "1.0.0"), None);
        assert_eq!(NewRelease::newer(&latest("v1.0", &[]), "1.0.0"), None);
    }

    /// Compared number by number, so 1.10 comes after 1.9, as text it would not.
    #[test]
    fn versions_compare_as_numbers() {
        assert_eq!(NewRelease::newer(&latest("v1.10.0", &[]), "1.9.2").unwrap().version, "1.10.0");
        assert!(NewRelease::newer(&latest("v1.0.1", &[]), "1.0").is_some());
    }

    /// GitHub refusing, or down, answers with something else: no update, and the next look tries again.
    #[test]
    fn an_answer_that_is_not_a_release_is_nothing() {
        assert_eq!(NewRelease::newer(r#"{"message": "API rate limit exceeded"}"#, "1.0.0"), None);
        assert_eq!(NewRelease::newer("<html>", "1.0.0"), None);
        assert_eq!(NewRelease::newer(&latest("nightly", &[]), "1.0.0"), None);
    }

    #[test]
    fn a_look_is_due_a_week_after_the_last_one() {
        assert_eq!(wait(0, 1_000 * DAY), 0);
        assert_eq!(wait(100 * DAY, 107 * DAY), 0);
        assert_eq!(wait(100 * DAY, 120 * DAY), 0);
    }

    /// Two days after a look, it waits an hour and checks the date again, not five days.
    #[test]
    fn before_then_it_waits_an_hour_at_most() {
        assert_eq!(wait(100 * DAY, 102 * DAY), 3_600);
        assert_eq!(wait(100 * DAY, 107 * DAY - 1_800), 1_800);
    }

    /// Asleep for most of the week: the first check after waking finds the look due.
    #[test]
    fn time_spent_asleep_counts_towards_the_week() {
        let last_look = 100 * DAY;
        assert_eq!(wait(last_look, last_look + 3_600), 3_600);
        assert_eq!(wait(last_look, last_look + 3_600 + 7 * DAY), 0);
    }

    #[test]
    fn a_release_build_it_can_replace_updates_itself() {
        assert_eq!(Route::of(APPLICATIONS, true, true), Route::Itself);
        assert_eq!(Route::of("/Users/someone/Applications/Mediamorph.app", true, true), Route::Itself);
    }

    /// Opened straight from the unzipped download, macOS runs it from a hidden copy no app may
    /// write to: it offers to move itself to Applications, from where it can.
    #[test]
    fn a_release_build_that_cannot_write_where_it_is_is_offered_the_move() {
        assert_eq!(Route::of("/private/var/folders/x/AppTranslocation/1/d/Mediamorph.app", true, false), Route::Move);
    }

    /// Already in Applications, on an account that may not change it: moving there again would
    /// fail at every start, so its menu says where to download the new version instead.
    #[test]
    fn a_release_build_in_applications_it_cannot_change_is_told() {
        assert_eq!(Route::of(APPLICATIONS, true, false), Route::Download);
    }

    /// Built on this Mac, it cannot tell a release build from anyone else's.
    #[test]
    fn a_copy_built_here_is_told_where_to_download() {
        assert_eq!(Route::of(APPLICATIONS, false, true), Route::Download);
        assert_eq!(Route::of("/Users/someone/Downloads/Mediamorph.app", false, false), Route::Download);
    }

    #[test]
    fn the_version_comes_from_the_info_plist() {
        let plist = "<dict>\n\t<key>CFBundleName</key>\n\t<string>Mediamorph</string>\n\t<key>CFBundleShortVersionString</key>\n\t<string>1.0.1</string>\n</dict>";
        assert_eq!(bundle_version(plist), Some("1.0.1".into()));
        assert_eq!(bundle_version("<dict></dict>"), None);
    }
}
