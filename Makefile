#
# Copyright (C) 2026 Medvedolog
#
# This is free software, licensed under the GNU General Public License v2.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-podkop-bot
PKG_VERSION:=0.19.18
PKG_RELEASE:=52

PKG_MAINTAINER:=Medvedolog
PKG_LICENSE:=GPL-2.0-or-later

LUCI_TITLE:=LuCI interface for podkop_bot (Telegram bot for podkop/sing-box)
# Native hwelp-proxy is an optional architecture-specific package. It is not a
# hard dependency: Bearhole installs it on demand, while the LuCI/control package
# remains installable and repairable when external feeds are unavailable.
LUCI_DEPENDS:=+luci-base +jq +curl
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
$(eval $(call BuildPackage,$(PKG_NAME)))
