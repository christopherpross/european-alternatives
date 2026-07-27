#!/usr/bin/env bash

trim_api_base_whitespace() {
    local value="${1-}"

    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    printf '%s' "$value"
}

is_loopback_api_host() {
    local host="${1,,}"

    if [[ "$host" == "[::1]" || "$host" == "[0:0:0:0:0:0:0:1]" ]]; then
        return 0
    fi

    case "$host" in
        localhost|localhost.localdomain|*.localhost)
            return 0
            ;;
    esac

    [[ "$host" =~ ^127(\.[0-9]{1,3}){0,3}$ ]]
}

validate_api_base() {
    local raw="${1-}"
    local value scheme rest authority suffix host

    value=$(trim_api_base_whitespace "$raw")

    if [[ -z "$value" ]]; then
        echo "error: EUROALT_API_BASE must not be empty" >&2
        return 1
    fi

    if [[ "$value" != *"://"* ]]; then
        echo "error: EUROALT_API_BASE must include an explicit http:// or https:// scheme" >&2
        return 1
    fi

    scheme="${value%%://*}"
    rest="${value#*://}"

    case "$scheme" in
        http|https)
            ;;
        *)
            echo "error: EUROALT_API_BASE must use http:// or https:// (got: ${scheme}://)" >&2
            return 1
            ;;
    esac

    authority="${rest%%[/?#]*}"
    suffix="${rest#"$authority"}"

    if [[ -z "$authority" ]]; then
        echo "error: EUROALT_API_BASE must include a host" >&2
        return 1
    fi

    if [[ "$authority" == *"@"* ]]; then
        echo "error: EUROALT_API_BASE must not include userinfo credentials" >&2
        return 1
    fi

    case "$suffix" in
        "")
            ;;
        "/")
            suffix=""
            ;;
        *)
            echo "error: EUROALT_API_BASE must be an origin only (no path, query, or fragment)" >&2
            return 1
            ;;
    esac

    if [[ "$authority" == \[* ]]; then
        if [[ ! "$authority" =~ ^(\[[0-9A-Fa-f:.]+\])(:[0-9]+)?$ ]]; then
            echo "error: EUROALT_API_BASE has an invalid bracketed host" >&2
            return 1
        fi

        host="${BASH_REMATCH[1]}"
    else
        if [[ ! "$authority" =~ ^([^:/?#]+)(:[0-9]+)?$ ]]; then
            echo "error: EUROALT_API_BASE has an invalid host or port" >&2
            return 1
        fi

        host="${BASH_REMATCH[1]}"
    fi

    if [[ "$scheme" == "http" ]] && ! is_loopback_api_host "$host"; then
        echo "error: EUROALT_API_BASE must use https:// for non-local targets; plain http:// is only allowed for localhost or loopback development targets" >&2
        return 1
    fi

    printf '%s://%s%s\n' "$scheme" "$authority" "$suffix"
}
