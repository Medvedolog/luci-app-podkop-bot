include $(TOPDIR)/rules.mk

PKG_NAME:=hwelp-proxy
PKG_VERSION:=0.1.1
PKG_RELEASE:=3
PKG_LICENSE:=GPL-2.0-or-later
PKG_MAINTAINER:=Medvedolog

include $(INCLUDE_DIR)/package.mk

define Package/hwelp-proxy
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Small HTTP to SOCKS/HTTP/direct failover proxy for Bearhole
  URL:=https://github.com/Medvedolog/luci-app-podkop-bot
  DEPENDS:=+libc
endef

define Package/hwelp-proxy/description
 HWELP proxy is the tiny native localhost gateway used by OpenWrt Bearhole.
 It accepts HTTP and CONNECT requests and forwards them through an ordered
 chain of SOCKS5/SOCKS5h, HTTP proxy or direct routes. Optional local Basic
 authentication and low-noise session accounting are built in. No TLS library
 or external proxy daemon is required.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/hwelp-proxy.c $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) -std=c99 -Wall -Wextra \
		-DHWELP_VERSION=\"$(PKG_VERSION)\" \
		-o $(PKG_BUILD_DIR)/hwelp-proxy \
		$(PKG_BUILD_DIR)/hwelp-proxy.c $(TARGET_LDFLAGS)
endef

define Package/hwelp-proxy/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/hwelp-proxy $(1)/usr/bin/hwelp-proxy
endef

# Removing the native gateway while Bearhole is active must never strand opkg,
# apk, curl or wget behind 127.0.0.1:1066. Run while the binary/control plane is
# still present. Upgrades are replacements, not destructive uninstalls.
define Package/hwelp-proxy/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
case "$${1:-}" in upgrade|upgrading) exit 0;; esac
if [ -x /usr/lib/podkop_bot/bearhole.sh ]; then
	/usr/lib/podkop_bot/bearhole.sh system-off >/dev/null 2>&1 || true
fi
if [ -x /etc/init.d/podkop-bearhole ]; then
	/etc/init.d/podkop-bearhole stop >/dev/null 2>&1 || true
	/etc/init.d/podkop-bearhole disable >/dev/null 2>&1 || true
fi
ubus call service delete '{"name":"podkop-bearhole"}' >/dev/null 2>&1 || true
rm -f /etc/rc.d/*podkop-bearhole \
	/etc/profile.d/99-podkop-bearhole.sh \
	/etc/opkg/99-podkop-bearhole.conf \
	/etc/opkg/99-hwelp-bootstrap.conf \
	/etc/apk/repositories.d/99-podkop-bearhole.list \
	/etc/apk/repositories.d/99-hwelp-bootstrap.list \
	2>/dev/null || true
for _f in /etc/environment /root/.curlrc /root/.wgetrc; do
	[ -f "$$_f" ] || continue
	sed -i '/^# BEGIN PODKOP BEARHOLE$$/,/^# END PODKOP BEARHOLE$$/d' "$$_f" 2>/dev/null || true
done
uci -q set podkop_bearhole.main.enabled='0' >/dev/null 2>&1 || true
uci -q commit podkop_bearhole >/dev/null 2>&1 || true
rm -rf /tmp/podkop_bot/bearhole 2>/dev/null || true
exit 0
endef

$(eval $(call BuildPackage,hwelp-proxy))
