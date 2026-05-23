# Subdirectories Node Server

Proxies subdirectory translation requests. Environment variables:

- `PORT` — server port (default `3000`)
- `BACKEND_API_URL` — Lingrix API base URL (default `https://api.lingrix.com`)
- `TRANSLATIONS_SERVER_URL` — translations server base URL (default production Railway URL)

# Installation Steps for Caddy on VPS

DigitalOcean VIP IP: 129.212.201.69

Installation steps:

ssh root@129.212.201.69

apt update && apt upgrade -y

apt install curl ufw unzip -y

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

nano /etc/caddy/Caddyfile

---- Change content to this file ----

proxy.lingrix.com {

    encode gzip zstd

    reverse_proxy https://subdirectory-translations.lingrix.com {
        header_up Host {host}
        header_up X-Forwarded-Host {host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote}
    }

}

---- End of change ----

Ctrl + O > Enter > Ctrl + X to save

caddy validate --config /etc/caddy/Caddyfile

systemctl reload caddy

ls /var/lib/caddy

nano /etc/caddy/Caddyfile

---- Change content to this file ----

{
email admin@lingrix.com

    on_demand_tls {
    	ask https://api.lingrix.com/api/public/caddy/allow-domain
    }

}

https:// {
tls {
on_demand
}

    encode gzip zstd

    reverse_proxy https://subdirectory-translations.lingrix.com {
    	header_up Host {upstream_hostport}
    	header_up X-Forwarded-Host {host}
    	header_up X-Forwarded-Proto {scheme}
    	header_up X-Real-IP {remote_host}
    }

}

---- End of change ----

systemctl reload caddy
