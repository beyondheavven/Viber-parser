#!/bin/bash
set -e

# Copy and normalize first-boot.sh
if [ -f /overrides/first-boot.sh ]; then
  tr -d '\r' < /overrides/first-boot.sh > /root/first-boot.sh
  chmod +x /root/first-boot.sh
fi

if [ -n "$PROXY_HOST" ]; then
  echo "--> [PROXY] Configuring transparent proxy via $PROXY_HOST:${PROXY_PORT:-50101}..."

  if ! command -v redsocks >/dev/null 2>&1; then
    echo "--> [PROXY] Installing redsocks and iptables..."
    apt-get update -qq && apt-get install -y -qq redsocks iptables
  fi

  P_PORT="${PROXY_PORT:-50101}"
  P_TYPE="${PROXY_TYPE:-socks5}"

  cat <<EOF > /etc/redsocks.conf
base {
	log_debug = off;
	log_info = on;
	log = "file:/var/log/redsocks.log";
	daemon = on;
	user = redsocks;
	group = redsocks;
	redirector = iptables;
}

redsocks {
	local_ip = 127.0.0.1;
	local_port = 12345;
	ip = ${PROXY_HOST};
	port = ${P_PORT};
	type = ${P_TYPE};
EOF

  if [ -n "$PROXY_USER" ]; then
    cat <<EOF >> /etc/redsocks.conf
	login = "${PROXY_USER}";
	password = "${PROXY_PASS}";
EOF
  fi

  echo "}" >> /etc/redsocks.conf

  touch /var/log/redsocks.log
  chown redsocks:redsocks /var/log/redsocks.log

  pkill -9 redsocks 2>/dev/null || true
  redsocks -c /etc/redsocks.conf

  # Configure iptables transparent proxy
  iptables -t nat -D OUTPUT -p tcp -m owner --uid-owner redsocks -j RETURN 2>/dev/null || true
  iptables -t nat -I OUTPUT 1 -p tcp -m owner --uid-owner redsocks -j RETURN

  iptables -t nat -D OUTPUT -p tcp -j REDSOCKS 2>/dev/null || true
  iptables -t nat -F REDSOCKS 2>/dev/null || true
  iptables -t nat -X REDSOCKS 2>/dev/null || true

  iptables -t nat -N REDSOCKS

  iptables -t nat -A REDSOCKS -d 0.0.0.0/8 -j RETURN
  iptables -t nat -A REDSOCKS -d 10.0.0.0/8 -j RETURN
  iptables -t nat -A REDSOCKS -d 127.0.0.0/8 -j RETURN
  iptables -t nat -A REDSOCKS -d 169.254.0.0/16 -j RETURN
  iptables -t nat -A REDSOCKS -d 172.16.0.0/12 -j RETURN
  iptables -t nat -A REDSOCKS -d 192.168.0.0/16 -j RETURN
  iptables -t nat -A REDSOCKS -d 224.0.0.0/4 -j RETURN
  iptables -t nat -A REDSOCKS -d 240.0.0.0/4 -j RETURN

  # Bypass proxy IP itself
  iptables -t nat -A REDSOCKS -d "${PROXY_HOST}" -j RETURN

  # Bypass DNS ports so proxy never blocks DNS
  iptables -t nat -A REDSOCKS -p tcp --dport 53 -j RETURN
  iptables -t nat -A REDSOCKS -p tcp --dport 853 -j RETURN

  # Fail direct DoT immediately so Android falls back to regular DNS. Keep the
  # redsocks user exempt in case the configured SOCKS endpoint itself uses 853.
  iptables -t filter -D OUTPUT -p tcp --dport 853 -m owner ! --uid-owner redsocks -j REJECT --reject-with tcp-reset 2>/dev/null || true
  iptables -t filter -I OUTPUT 1 -p tcp --dport 853 -m owner ! --uid-owner redsocks -j REJECT --reject-with tcp-reset

  # Redirect all other TCP to redsocks
  iptables -t nat -A REDSOCKS -p tcp -j REDIRECT --to-ports 12345

  iptables -t nat -A OUTPUT -p tcp -j REDSOCKS

  echo "--> [PROXY] Transparent proxy activated successfully."
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
