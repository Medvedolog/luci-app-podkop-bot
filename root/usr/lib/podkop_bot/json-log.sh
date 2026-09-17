# Shared JSON encoder for log chunks returned by rpcd backends.
# Keep TAB/LF/CR (jq escapes them), strip ANSI CSI and unsafe C0/DEL.
pb_json_log_filter() {
    _pb_esc=$(printf '\033')
    sed "s/${_pb_esc}\\[[0-9;?]*[a-zA-Z]//g" \
        | tr -d '\000-\010\013\014\016-\037\177' \
        | jq -Rs .
}
pb_json_log_str() {
    printf '%s' "$1" | pb_json_log_filter
}
