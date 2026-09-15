# HWELP proxy

`hwelp-proxy` is the small native gateway used by OpenWrt Bearhole.

The name is a wordplay on **help** and Old English **hwelp** (a young animal / whelp): a small helper living next to Bearhole.

## Runtime contract

- binds only to loopback (`127.0.0.1` by default);
- listen port is configurable by Bearhole, default `1066`;
- accepts HTTP proxy requests and HTTPS `CONNECT`;
- ordered upstream failover: `direct://`, `socks5://` / `socks5h://`, `http://`;
- SOCKS5 username/password authentication is supported;
- HTTP upstream Basic authentication is supported;
- credentials are URL-decoded and never written to logs;
- no TLS interception, TUN/TAP, nftables, sing-box or ucode dependency;
- runtime dependency: libc only.

The process reads `/tmp/podkop_bot/bearhole/routes.conf` on each new client connection, so the Bearhole control plane can replace the route set without restarting HWELP.

## OpenWrt package

The source tree is a normal OpenWrt package. `owlab build` can cross-compile it for any OpenWrt package architecture supported by the selected release, for example:

```sh
cd hwelp-proxy
owlab build --release 24.10.8 --arch aarch64_cortex-a53
owlab build --release 25.12.5 --arch aarch64_cortex-a53
```

The LuCI package deliberately does **not** depend on `hwelp-proxy`. Bearhole installs it on demand from owfeed so a missing native engine never blocks installation or repair of `luci-app-podkop-bot` itself.
