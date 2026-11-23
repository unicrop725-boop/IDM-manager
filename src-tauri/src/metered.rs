//! Is the internet connection metered (a phone hotspot, mobile data, a plan with a data cap)?
//! Windows keeps that setting per network ("Set as metered connection"); phone hotspots are marked metered
//! automatically. A user-supplied list of hotspot names covers the rest.

use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    /// Windows says downloads on this connection may cost money or count against a cap.
    pub metered: bool,
    /// Plain-language reason when `metered` is set.
    pub why: Option<String>,
    /// Wi-Fi network name, when connected through Wi-Fi.
    pub ssid: Option<String>,
}

impl Network {
    /// Why downloads should not run on this connection, if they should not: metered, or a hotspot the user named.
    pub fn restriction(&self, hotspot_names: &[String]) -> Option<String> {
        if let Some(ssid) = &self.ssid {
            if hotspot_names.iter().any(|h| !h.trim().is_empty() && h.trim().eq_ignore_ascii_case(ssid.trim())) {
                return Some(format!("connected to the hotspot \"{ssid}\""));
            }
        }
        if self.metered {
            return Some(self.why.clone().unwrap_or_else(|| "this is a metered connection".into()));
        }
        None
    }
}

#[cfg(windows)]
pub fn detect() -> Network {
    use windows::Networking::Connectivity::{NetworkCostType, NetworkInformation};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    // WinRT needs the thread to be set up; this is a no-op when it already is.
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let mut net = Network::default();
    let Ok(profile) = NetworkInformation::GetInternetConnectionProfile() else { return net };

    if let Ok(details) = profile.WlanConnectionProfileDetails() {
        if let Ok(ssid) = details.GetConnectedSsid() {
            let s = ssid.to_string();
            if !s.is_empty() {
                net.ssid = Some(s);
            }
        }
    }
    if profile.IsWwanConnectionProfile().unwrap_or(false) {
        net.metered = true;
        net.why = Some("you are on mobile data".into());
    }
    if let Ok(cost) = profile.GetConnectionCost() {
        if matches!(cost.NetworkCostType(), Ok(NetworkCostType::Fixed) | Ok(NetworkCostType::Variable)) {
            net.metered = true;
            net.why.get_or_insert_with(|| "Windows marks this connection as metered".into());
        }
        if cost.Roaming().unwrap_or(false) {
            net.metered = true;
            net.why = Some("you are roaming".into());
        }
        if cost.OverDataLimit().unwrap_or(false) {
            net.metered = true;
            net.why = Some("the data limit of this connection is used up".into());
        }
    }
    net
}

#[cfg(not(windows))]
pub fn detect() -> Network {
    Network::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metered_and_named_hotspots_are_restricted() {
        let open = Network::default();
        assert_eq!(open.restriction(&[]), None);

        let metered = Network { metered: true, why: Some("Windows marks this connection as metered".into()), ssid: None };
        assert_eq!(metered.restriction(&[]).as_deref(), Some("Windows marks this connection as metered"));

        let home = Network { metered: false, why: None, ssid: Some("Pixel 8 Hotspot".into()) };
        assert_eq!(home.restriction(&["home wifi".into()]), None);
        let r = home.restriction(&["  pixel 8 hotspot ".into()]).unwrap();
        assert!(r.contains("Pixel 8 Hotspot"), "{r}");
        assert_eq!(home.restriction(&["".into()]), None, "an empty entry never matches");
    }

    /// Reads this PC's real connection: `cargo test --lib live_detect_network -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_detect_network() {
        let n = detect();
        println!("{n:?}");
    }
}
