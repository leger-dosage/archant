# Hosting at home behind Tailscale

This guide takes one household from a bare machine at home to Archant reachable only on its [tailnet](https://tailscale.com/kb/1136/tailnet), the private encrypted network Tailscale builds between your own devices, and connected to a real bank. Nothing listens on the internet. Each step links to [deployment.md](deployment.md) for the recipe it already holds, rather than copying it.

A tailnet shrinks the attack surface; it does not replace the password and [two-factor sign-in](deployment.md#two-factor-sign-in). A stolen phone or laptop is on the tailnet too, so turn two-factor on once the administrator exists.

## 1. The machine

This guide assumes Linux with Docker Engine: the gateway and firewall recipes below do not apply to Docker Desktop on a Mac, whose containers do not see the host's bridge gateway. Pick a machine that stays on day and night: a small PC, a NUC or an old laptop. The database lives on its disk, so use an SSD, not a Raspberry Pi booting from an SD card, which wears out under a database's writes and fails without warning.

Encrypt the whole disk when you install the system, with LUKS. A stolen machine then gives nothing away. The price: after a power cut, the machine waits at the passphrase prompt until someone types it, and Archant stays down until then.

## 2. Docker

Install Docker Engine and its Compose plugin by following [Docker's instructions](https://docs.docker.com/engine/install/) for your system. `docker compose version` must answer.

## 3. Join the tailnet

[Install Tailscale](https://tailscale.com/download) on the machine, then join your tailnet:

```bash
sudo tailscale up
```

Name the machine now, in the [admin console](https://login.tailscale.com/admin/machines) or with `sudo tailscale set --hostname <machine>`. Once HTTPS is on, its full name, `<machine>.<tailnet>.ts.net`, lands in the public [certificate transparency](https://certificate.transparency.dev/) log, which anyone can search and bots scan within minutes. Pick a name that reveals nothing: not `archant`, not `banque`, not your family name. The tailnet part of the name is public too; keep the random one Tailscale assigns. Renaming the machine later changes its `ts.net` address, and `ARCHANT_URL` and the Enable Banking redirect URL change with it.

In the admin console, on the [Machines](https://login.tailscale.com/admin/machines) page, disable key expiry for this machine, so it does not fall off the tailnet after six months. On the [DNS](https://login.tailscale.com/admin/dns) page, enable MagicDNS, then HTTPS certificates.

Every device that opens Archant joins the same tailnet: install Tailscale on your phone and laptop and sign in with the same account.

## 4. Serve Archant over HTTPS

Tailscale gets the certificate and forwards the requests to the loopback port Archant listens on:

```bash
sudo tailscale serve --bg 8787
```

`--bg` keeps the configuration across reboots. `tailscale serve status` prints the address, `https://<machine>.<tailnet>.ts.net`. It resolves only on the tailnet. Do not use `tailscale funnel`, which would put Archant on the internet.

## 5. Configure and start Archant

In a directory named `archant`, fetch `docker-compose.yml` as in [Docker — the reference target](deployment.md#docker--the-reference-target), then write the `.env` Compose reads beside it. Run this block once: running it again replaces the secrets, which signs out every session and leaves every bank to connect again:

```bash
mkdir archant && cd archant
curl --fail --location --remote-name https://raw.githubusercontent.com/leger-dosage/archant/main/docker-compose.yml
umask 077
cat > .env <<EOF
ARCHANT_URL=https://<machine>.<tailnet>.ts.net
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
SYNC_SECRET=$(openssl rand -base64 32)
EOF
docker compose up --detach --wait
```

`umask 077` makes `.env` readable by you alone. Pin the release with `ARCHANT_VERSION` in the same file, as [Upgrading](deployment.md#upgrading) explains. The [Variables](deployment.md#variables) table lists the rest.

`ARCHANT_URL` must be the `ts.net` address exactly: the server refuses a sign-in from any other, so every device, the machine included, opens Archant there. Left empty, it means `http://localhost:8787`, so setup and every sign-in from the `ts.net` address are refused; the page then says to set `ARCHANT_URL` to the address in the address bar and restart.

Keep the port on `127.0.0.1`, as `docker-compose.yml` publishes it, and add no `compose.override.yml`. Only `tailscale serve` then reaches the container, from the host. The [loopback port](deployment.md#docker--the-reference-target) explains why.

`tailscale serve` is a reverse proxy on the host, so set `TRUSTED_PROXIES` as [Behind a reverse proxy](deployment.md#behind-a-reverse-proxy) says. Without it, every device shares one sign-in limit. With it, every process on the host can choose the address the limit counts, so the host is trusted, as the [security model](security-model.md#trusted-proxies) explains. Print the Docker network's gateway, add it to `.env`, and restart:

```bash
echo "TRUSTED_PROXIES=$(docker network inspect archant_default --format '{{(index .IPAM.Config 0).Gateway}}')" >> .env
docker compose up --detach --wait
```

`docker compose down` removes the `archant_default` network, and the one `up` creates next may have another gateway: after a `down`, print the gateway again and update `TRUSTED_PROXIES` in `.env`.

`tailscale serve` is expected to write `X-Forwarded-For`, but no one has checked it with Archant yet. If it does not, the variable changes nothing: every device shares the limit, as without it.

## 6. Create the administrator

While the database has no user, the server prints a setup token at every start, in a `warn` line:

```bash
docker compose logs archant | grep 'Setup is open'
```

Take the token from the last line, open `https://<machine>.<tailnet>.ts.net` from a device on the tailnet, and create the administrator at `/setup`. Then turn two-factor sign-in on in « Réglages » › « Sécurité ».

## 7. Schedule the daily sync, if the machine stays on

This step is optional: the first page you open each day syncs the banks, as [Scheduled synchronisation](deployment.md#scheduled-synchronisation) explains, so a machine that sleeps at night misses nothing. A cron only helps a machine that stays on, by syncing before you open Archant.

The same section describes `POST /api/sync`. Call it from the host's cron on `http://127.0.0.1:8787`, not the `ts.net` address: the sync keeps running when Tailscale is down or logged out, and the secret never leaves the machine. `/api/sync` takes no session and no origin check, so plain loopback HTTP works.

Keep the secret out of the crontab line, in a header file only you can read:

```bash
umask 077
printf 'Authorization: Bearer %s\n' "$(grep '^SYNC_SECRET=' .env | cut -d= -f2-)" > ~/.archant-sync-header
```

Then, in `crontab -e`, every morning at 6:

```crontab
0 6 * * * curl --fail --silent --show-error -X POST --header @"$HOME/.archant-sync-header" http://127.0.0.1:8787/api/sync
```

`--header @file` reads the header from the file, so the secret never shows in the process list either. Change `SYNC_SECRET` in `.env` and the header file together.

## 8. Connect a bank

Follow [Connecting a bank](deployment.md#connecting-a-bank). `ENCRYPTION_KEY` is already in `.env`, so skip its step 2. For your real accounts, register a production application with the redirect URL `https://<machine>.<tailnet>.ts.net/settings/banks/callback`. Enable Banking accepts a `ts.net` address for a production application.

## Backups

Nothing backs up this machine for you. Take a copy with the `VACUUM INTO` recipe in [Backups](deployment.md#backups), and from time to time copy the file to another device: a laptop, an external drive kept elsewhere.

Nothing else holds your data off this disk: the copies the server takes before a migration sit on the same disk. A dead or stolen machine loses everything written since your last manual copy.

## Keep two secrets off the machine

Store `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` from `.env` in a password manager, apart from the backups, so that a lost machine does not take the keys with it. A leaked backup then gives no access to your banks, since the bank sessions and the Enable Banking key in it are encrypted, but the transaction history in it is readable: keep the copy on an encrypted device.

Losing `ENCRYPTION_KEY` means connecting every bank again: the bank sessions and the Enable Banking key it encrypted become unreadable. Losing `BETTER_AUTH_SECRET` signs out every session and voids two-factor sign-in; [`reset-password`](deployment.md#passwords) turns two-factor off, then you turn it on again.

## A VPS instead

When home is not an option, follow the same steps on a VPS in the EU, such as OVH in France or Hetzner in Germany. Join it to the tailnet as in step 3, then close every inbound port except SSH in the provider's firewall or with `ufw`:

```bash
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw enable
```

Tailscale needs no inbound port. Docker writes its own firewall rules and bypasses `ufw` for a published port, which is one more reason to keep Archant's port on `127.0.0.1`. The provider controls the hardware, so full-disk encryption protects less there than at home, and the backup advice above holds unchanged.
