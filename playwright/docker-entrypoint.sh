#!/bin/sh
# Runner entrypoint: install the per-run workload CA into real trust stores,
# then exec the requested command. No certificate verification is disabled —
# Chromium reads the NSS shared DB, WebKit reads the system bundle, and the
# Node API request context uses NODE_EXTRA_CA_CERTS.
set -e

CA=/pw-private/ca.crt

if [ -f "$CA" ]; then
  cp "$CA" /usr/local/share/ca-certificates/componode-pw.crt
  update-ca-certificates >/dev/null 2>&1 || true
  mkdir -p "$HOME/.pki/nssdb"
  if ! certutil -d "sql:$HOME/.pki/nssdb" -L -n componode-pw >/dev/null 2>&1; then
    certutil -d "sql:$HOME/.pki/nssdb" -N --empty-password >/dev/null 2>&1 || true
    certutil -d "sql:$HOME/.pki/nssdb" -A -n componode-pw -t "C,," -i "$CA" >/dev/null 2>&1 || true
  fi
  export NODE_EXTRA_CA_CERTS="$CA"
fi

exec "$@"
