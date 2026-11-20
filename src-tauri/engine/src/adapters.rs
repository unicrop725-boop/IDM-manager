//! Network adapters, for multi-network bonding ("Turbo Mode").
//!
//! [`detect`] lists the adapters that can actually reach the internet right now: link up, a
//! default gateway, a usable IPv4 address. Wi-Fi, Ethernet, USB tethering (which Windows shows as
//! an Ethernet-type "Remote NDIS" device) and mobile broadband are all included; loopback,
//! tunnels, VPN / virtual-machine / container switches and link-local addresses are not.
//!
//! With Turbo Mode on, each connection of a download is bound to the IPv4 address of one adapter
//! (see `worker::AdapterSet`), so the segments of one file travel over several networks at once.
//!
//! **Limit, stated plainly:** the binding is by *source address*. Windows then routes the packets
//! by the adapter that owns that address when that adapter has its own default route, which is
//! the normal situation for Wi-Fi + Ethernet or a tethered phone (each has its own gateway).
//! It cannot force a path when two adapters sit on the same subnet behind the same router.

use std::net::{IpAddr, Ipv4Addr};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdapterKind {
    Wifi,
    Ethernet,
    /// Mobile broadband (SIM / WWAN).
    Mobile,
    Other,
}

/// One usable network adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInfo {
    /// Stable id (the OS adapter name / GUID).
    pub id: String,
    /// Name shown to the user, e.g. "Wi-Fi" or "Ethernet 2".
    pub name: String,
    pub kind: AdapterKind,
    /// The local address connections are bound to.
    pub ip: IpAddr,
}

/// Adapter types we use (IANA `ifType`). Anything not listed (loopback 24, tunnel 131, ...) is skipped.
pub fn kind_of(if_type: u32) -> Option<AdapterKind> {
    match if_type {
        6 => Some(AdapterKind::Ethernet),                       // IF_TYPE_ETHERNET_CSMACD (also USB tethering)
        71 => Some(AdapterKind::Wifi),                          // IF_TYPE_IEEE80211
        243 | 244 => Some(AdapterKind::Mobile),                 // WWANPP / WWANPP2
        23 => Some(AdapterKind::Mobile),                        // PPP (dial-up / some modems)
        _ => None,
    }
}

/// Virtual switches and VPN adapters carry no independent internet path of their own.
pub fn looks_virtual(description: &str) -> bool {
    let d = description.to_ascii_lowercase();
    [
        "virtual", "vmware", "virtualbox", "hyper-v", "vethernet", "vpn", "tap-windows", "wintun", "wireguard",
        "tailscale", "zerotier", "docker", "wsl", "loopback", "bluetooth", "miniport",
    ]
    .iter()
    .any(|w| d.contains(w))
}

/// Addresses that cannot be used to reach the internet.
pub fn usable_ipv4(ip: Ipv4Addr) -> bool {
    !(ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast())
}

/// All adapters that can reach the internet right now (empty on platforms without support).
pub fn detect() -> Vec<AdapterInfo> {
    platform::detect()
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_INCLUDE_GATEWAYS, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER,
        GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};

    const IF_OPER_STATUS_UP: i32 = 1;

    unsafe fn wide_to_string(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut len = 0;
        while *p.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
    }

    unsafe fn ansi_to_string(p: *const u8) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut len = 0;
        while *p.add(len) != 0 {
            len += 1;
        }
        String::from_utf8_lossy(std::slice::from_raw_parts(p, len)).into_owned()
    }

    pub fn detect() -> Vec<AdapterInfo> {
        let flags = GAA_FLAG_INCLUDE_GATEWAYS | GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
        // 8-byte aligned buffer (the structures contain pointers and u64s).
        let mut buf: Vec<u64> = vec![0; 4096];
        let mut size = (buf.len() * 8) as u32;
        let mut rc = 0;
        for _ in 0..4 {
            rc = unsafe {
                GetAdaptersAddresses(
                    AF_INET as u32,
                    flags,
                    std::ptr::null(),
                    buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                    &mut size,
                )
            };
            if rc != ERROR_BUFFER_OVERFLOW {
                break;
            }
            buf = vec![0; (size as usize).div_ceil(8) + 64];
            size = (buf.len() * 8) as u32;
        }
        if rc != ERROR_SUCCESS {
            return Vec::new();
        }

        let mut out = Vec::new();
        let mut cur = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
        while !cur.is_null() {
            // SAFETY: the OS filled a valid linked list inside `buf`, which outlives this loop.
            let a = unsafe { &*cur };
            cur = a.Next;
            if a.OperStatus != IF_OPER_STATUS_UP {
                continue;
            }
            let Some(kind) = kind_of(a.IfType) else { continue };
            if a.FirstGatewayAddress.is_null() {
                continue; // no default gateway: this network has no internet path
            }
            let description = unsafe { wide_to_string(a.Description) };
            if looks_virtual(&description) {
                continue;
            }
            let mut ip = None;
            let mut u = a.FirstUnicastAddress;
            while !u.is_null() {
                let ua = unsafe { &*u };
                u = ua.Next;
                let sa = ua.Address.lpSockaddr;
                if sa.is_null() || unsafe { (*sa).sa_family } != AF_INET {
                    continue;
                }
                let sin = unsafe { &*(sa as *const SOCKADDR_IN) };
                let v4 = Ipv4Addr::from(u32::from_be(unsafe { sin.sin_addr.S_un.S_addr }));
                if usable_ipv4(v4) {
                    ip = Some(v4);
                    break;
                }
            }
            let Some(ip) = ip else { continue };
            let name = unsafe { wide_to_string(a.FriendlyName) };
            out.push(AdapterInfo {
                id: unsafe { ansi_to_string(a.AdapterName as *const u8) },
                name: if name.is_empty() { description } else { name },
                kind,
                ip: IpAddr::V4(ip),
            });
        }
        out
    }
}

#[cfg(not(windows))]
mod platform {
    use super::AdapterInfo;

    pub fn detect() -> Vec<AdapterInfo> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wifi_ethernet_and_mobile_are_used_loopback_and_tunnels_are_not() {
        assert_eq!(kind_of(71), Some(AdapterKind::Wifi));
        assert_eq!(kind_of(6), Some(AdapterKind::Ethernet));
        assert_eq!(kind_of(243), Some(AdapterKind::Mobile));
        assert_eq!(kind_of(24), None, "loopback");
        assert_eq!(kind_of(131), None, "tunnel");
    }

    #[test]
    fn virtual_adapters_are_recognised_but_usb_tethering_is_not_one() {
        assert!(looks_virtual("Hyper-V Virtual Ethernet Adapter"));
        assert!(looks_virtual("VMware Virtual Ethernet Adapter for VMnet8"));
        assert!(looks_virtual("TAP-Windows Adapter V9"));
        assert!(!looks_virtual("Remote NDIS based Internet Sharing Device"));
        assert!(!looks_virtual("Intel(R) Wi-Fi 6 AX201 160MHz"));
        assert!(!looks_virtual("Realtek PCIe GbE Family Controller"));
    }

    #[test]
    fn unusable_addresses_are_rejected() {
        assert!(!usable_ipv4("127.0.0.1".parse().unwrap()));
        assert!(!usable_ipv4("169.254.3.4".parse().unwrap()));
        assert!(!usable_ipv4("0.0.0.0".parse().unwrap()));
        assert!(usable_ipv4("192.168.1.20".parse().unwrap()));
        assert!(usable_ipv4("10.0.0.7".parse().unwrap()));
    }

    #[test]
    fn detect_does_not_crash_and_reports_only_usable_adapters() {
        for a in detect() {
            assert!(!a.name.is_empty());
            match a.ip {
                IpAddr::V4(v4) => assert!(usable_ipv4(v4)),
                IpAddr::V6(_) => panic!("only IPv4 is used for binding"),
            }
        }
    }
}
