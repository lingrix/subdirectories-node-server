# Subdirectories Node Server

Proxies subdirectory translation requests. Environment variables:

- `PORT` — server port (default `3000`)
- `BACKEND_API_URL` — Lingrix API base URL (default `https://api.lingrix.com`)
- `TRANSLATIONS_SERVER_URL` — translations server base URL (default production Railway URL)

Caddy and this Node app run on the **same droplet**. Caddy proxies to `localhost:3000` — do not point Caddy at a separate DO App Platform URL (403 from Cloudflare).

Customer DNS:
- **Apex** → A record → `129.212.201.69`
- **WWW** → CNAME → `proxy.lingrix.com`

---

# Installation Steps for Caddy on VPS

DigitalOcean VIP IP: 129.212.201.69

Installation steps:

ssh root@129.212.201.69

apt update && apt upgrade -y

apt install curl ufw unzip git -y

ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable

ufw status

apt install -y debian-keyring debian-archive-keyring apt-transport-https

curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
| gpg --dearmor \
-o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

apt update
apt install caddy -y

caddy version

---

# Install Node + subdirectories server

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

apt install -y nodejs

mkdir -p /opt/lingrix
cd /opt/lingrix
git clone https://github.com/lingrix/subdirectories-node-server.git
cd subdirectories-node-server
npm ci

Quick test (Ctrl+C to stop before systemd step):

PORT=3000 node index.js

Other session:

curl -s -H "X-Forwarded-Host: www.example.com" http://127.0.0.1:3000/ | head

---

# systemd service (keeps Node running)

cat > /etc/systemd/system/lingrix-subd.service << 'EOF'
[Unit]
Description=Lingrix Subdirectory Node Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/lingrix/subdirectories-node-server
Environment=PORT=3000
Environment=BACKEND_API_URL=https://api.lingrix.com
Environment=TRANSLATIONS_SERVER_URL=https://translations-server-production.up.railway.app
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lingrix-subd
systemctl start lingrix-subd
systemctl status lingrix-subd

Logs: journalctl -u lingrix-subd -f

---

# Caddyfile

nano /etc/caddy/Caddyfile

---- Change content to this file ----

```
{
	email admin@lingrix.com

	on_demand_tls {
		ask https://api.lingrix.com/api/public/caddy/allow-domain
	}
}

proxy.lingrix.com {
	encode gzip zstd

	reverse_proxy localhost:3000 {
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
		header_up X-Real-IP {remote_host}
	}
}

https:// {
	tls {
		on_demand
	}

	encode gzip zstd

	reverse_proxy localhost:3000 {
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
		header_up X-Real-IP {remote_host}
	}
}
```

---- End of change ----

Ctrl + O > Enter > Ctrl + X to save

caddy validate --config /etc/caddy/Caddyfile

systemctl restart caddy

ls /var/lib/caddy

Verify Caddy is running:

systemctl status caddy

---

# Verify

Node directly:

curl -s -H "X-Forwarded-Host: www.example.com" http://127.0.0.1:3000/ | head

Through Caddy — www:

curl -sv "https://proxy.lingrix.com/" -H "Host: www.example.com"

Through Caddy — apex:

curl -sv "https://example.com/" --resolve example.com:443:129.212.201.69

Watch logs if something fails:

journalctl -u lingrix-subd -f

journalctl -u caddy -f

---

# Optional swap (small droplets)

fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

---

# Deploy updates

cd /opt/lingrix/subdirectories-node-server
git pull
npm ci
systemctl restart lingrix-subd
