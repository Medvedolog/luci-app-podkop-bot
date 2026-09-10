from pathlib import Path

Path('version.txt').write_text('0.19.17\n')

p = Path('Makefile')
s = p.read_text()
assert s.count('PKG_VERSION:=0.19.16') == 1
p.write_text(s.replace('PKG_VERSION:=0.19.16', 'PKG_VERSION:=0.19.17', 1))

p = Path('root/usr/libexec/rpcd/podkop_bot')
s = p.read_text()
assert s.count('LUCI_APP_VERSION="0.19.16"') == 1
p.write_text(s.replace('LUCI_APP_VERSION="0.19.16"', 'LUCI_APP_VERSION="0.19.17"', 1))

p = Path('README.md')
s = p.read_text()
if '`0.19.16` · OpenWrt · LuCI · opkg / apk' in s:
    s = s.replace('`0.19.16` · OpenWrt · LuCI · opkg / apk', '`0.19.17` · OpenWrt · LuCI · opkg / apk', 1)
p.write_text(s)

p = Path('CHANGELOG.md')
s = p.read_text()
marker = '### Unreleased — native OpenWrt packages through owfeed\n\n'
assert marker in s
entry = '''### Unreleased — native OpenWrt packages through owfeed\n\n- **[0.19.17 / security]** Anonymous `sender_chat` admins are opt-in; default is disabled.\n- **[0.19.17 / security]** Executable bot uploads require a fresh 5-minute private-chat session owned by the primary administrator; extra admins and anonymous sender_chat identities cannot upload code.\n- **[0.19.17 / security]** Unauthorized actors are rate-limited and temporarily blocked in RAM after repeated attempts; optional persistent UCI blocklists are supported by `blocked_user_ids` and `blocked_sender_chat_ids`.\n- **[0.19.17 / security]** Attacker-controlled Telegram message bodies are no longer written verbatim to syslog.\n\n'''
p.write_text(s.replace(marker, entry, 1))

# Permanent source guards for the root-Telegram security boundary.
p = Path('tools/check-sources.sh')
s = p.read_text()
marker = '[ "$fail" -eq 0 ] || { echo "source checks failed"; exit 1; }\necho "source checks passed"'
assert marker in s
security = r'''# Telegram/root security invariants (0.19.17+).
BOT_SRC="root/usr/lib/podkop_bot/podkop_bot"
grep -Fq '[ -z "$ALLOW_ANON_ADMINS" ] && ALLOW_ANON_ADMINS="0"' "$BOT_SRC" || {
    echo "security: anonymous admins must default to disabled" >&2; exit 1;
}
grep -Fq 'UPLOAD_SESSION_TTL=300' "$BOT_SRC" || {
    echo "security: upload session TTL guard missing" >&2; exit 1;
}
grep -Fq '[ "$chat_type" != "private" ] || [ "$user_id" != "$ADMIN_ID" ]' "$BOT_SRC" || {
    echo "security: uploaded executable must be primary-admin/private-chat gated" >&2; exit 1;
}
grep -Fq 'blocked_user_ids' "$BOT_SRC" && grep -Fq 'blocked_sender_chat_ids' "$BOT_SRC" || {
    echo "security: persistent manual blocklist support missing" >&2; exit 1;
}
if grep -E 'logger .*\[Security\].*(text=|\$\{text\}|\$text)' "$BOT_SRC" >/dev/null 2>&1; then
    echo "security: attacker-controlled Telegram text must not reach syslog" >&2; exit 1;
fi

'''
p.write_text(s.replace(marker, security + marker, 1))
