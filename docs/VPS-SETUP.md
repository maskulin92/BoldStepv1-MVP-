# Hermes Agent — Tencent Cloud VPS Setup Guide

**Project:** Boldstep MVP
**Target:** Tencent Cloud Lighthouse / CVM — 1 vCPU, 1GB RAM, 20GB, Ubuntu 22.04 LTS
**Region:** Singapore (`ap-singapore`) — latency terendah ke Malaysia
**App:** Next.js on Vercel (`https://bold-stepv1-mvp.vercel.app`) — Hermes agent runs on VPS, talks to the app over its REST API only

---

## Gambaran Seni Bina

```
┌─────────────────────┐  REST (HERMES_API_KEY)  ┌──────────────────────┐
│  Tencent VPS         │ ─────────────────────► │  Vercel (Next.js)    │
│  hermes/agent.mjs    │   POST /api/meta/sync   │  bold-stepv1-mvp     │
│  (pm2, 24/7)         │   POST /api/approvals   │                      │
└─────────────────────┘                         └──────────┬───────────┘
       │                                                    │
       │ GLM_API_KEY (optional)                             │ Firestore
       ▼                                                    ▼
  api.z.ai                                          Firebase project boldstep-v1
```

Setiap kitaran: sync data setiap akaun → analisis (GLM atau heuristik) → failkan cadangan sebagai Pending Approvals → Telegram notify (dihantar oleh app, bukan agent) → auto-execute hanya jika diaktifkan dalam tetapan Hermes.

---

## Bahagian A — Generate HERMES_API_KEY (dahulu, sebelum VPS)

Kunci mesti **sama nilai** di dua tempat: Vercel env (app) dan VPS env (agent).

```powershell
node -e "console.log('boldstep_sk_hermes_' + require('crypto').randomBytes(24).toString('hex'))"
```

Simpan output. Kemudian:

1. **Vercel → bold-stepv1-mvp → Settings → Environment Variables → Add:**
   - Name: `HERMES_API_KEY`
   - Value: (output atas)
   - Environments: Production ✓
   - **Redeploy** selepas tambah (Builds → Deployments → … → Redeploy)
2. **Uji dari PC kau dahulu** — agent pun boleh diuji secara tempatan sebelum VPS:
   ```powershell
   cd "C:\Users\Admin\Desktop\Boldstep\BoldStepMvp\BoldStepv1(MVP)"
   $env:HERMES_API_KEY="boldstep_sk_hermes_xxx"; $env:BOLDSTEP_API_URL="https://bold-stepv1-mvp.vercel.app"; npm run hermes
   ```
   Output harus tunjuk `cycle done`. Cadangan (jika ada) akan muncul dalam Pending Approvals dashboard.

---

## Bahagian B — Tencent Cloud Registration & VM

### B1. Daftar & beli

1. Pergi ke `https://www.tencentcloud.com` (international site — harga USD) atau `https://cloud.tencent.com` jika ada akaun RMB.
2. Daftar akaun (email / Google / GitHub), verify email, **aktifkan 2FA** (Console → Account → Security Settings).
3. Beli **Lighthouse** (paling sesuai untuk VM kecil):
   - Product → Lighthouse → Create Instance
   - Region: **Singapore**
   - Image: **Ubuntu 22.04 LTS**
   - Bundle: yang termurah dengan 1 vCPU / 1GB RAM / 20-25GB SSD (~USD 5-7/bulan, atau pilih plan tahunan untuk diskaun)
   - Duration: ikut bajet (bulanan ok)
4. Semasa checkout,.tencent akan minta set **password root** atau SSH key — pilih **SSH key** (lebih selamat):
   - Kalau tak ada key: buat di lokal `ssh-keygen -t ed25519 -f ~/.ssh/boldstep_hermes` (Windows: guna `ssh-keygen` dalam PowerShell, path `%USERPROFILE%\.ssh\boldstep_hermes`)
   - Add public key (`boldstep_hermes.pub`) dalam Lighthouse → Key Pairs dahulu, kemudian pilih semasa beli

### B2. Firewall / security group

Lighthouse instance → Firewall tab, pastikan hanya:

| Port | Proto | Source | Tujuan |
|---|---|---|---|
| 22 | TCP | IP office/rumah kau sahaja (atau 0.0.0.0/0 sementara, ganti kemudian) | SSH |
| — | — | — | **Tiada port lain perlu dibuka** — agent hanya membuat *outbound* HTTPS |

### B3. Dapatkan IP

Instance list → copy **Public IP** (contoh `43.136.x.x`). Kita panggil `<VPS_IP>` dalam dokumen ni.

---

## Bahagian C — SSH Configuration

Dari PC (PowerShell):

```powershell
# Sekali sahaja — copy private key ke default location (kalau guna custom path)
# Windows OpenSSH akan cari ~/.ssh/
ssh -i $env:USERPROFILE\.ssh\boldstep_hermes ubuntu@<VPS_IP>

# First login: jawab yes pada host key prompt
```

**Passwordless config** (optional tapi bagus) — tambah dalam `%USERPROFILE%\.ssh\config`:

```
Host hermes-vps
    HostName <VPS_IP>
    User ubuntu
    IdentityFile ~/.ssh/boldstep_hermes
    ServerAliveInterval 60
```

Selepas itu cuma `ssh hermes-vps`.

### C1. Hardening asas (5 minit)

```bash
# Update sistem
sudo apt update && sudo apt upgrade -y

# SSH: disable password login & root login
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Fail2ban untuk SSH brute-force
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban

# Zon waktu (untuk log yang masuk akal)
sudo timedatectl set-timezone Asia/Kuala_Lumpur
```

---

## Bahagian D — Node.js Installation

```bash
# Node 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node -v   # v20.x
npm -v

# pm2 — process manager yang akan jaga agent 24/7
sudo npm install -g pm2
```

> Nota: agent tak perlukan `npm install` penuh project — ia fail `.mjs` standalone yang guna `fetch` (dah built-in dalam Node 18+). Tapi clone penuh repo memudahkan update. Kalau nak minimal, cuma copy `hermes/agent.mjs` + `.env.hermes` — agent akan jalan terus.

---

## Bahagian E — Repository Cloning

```bash
# Git basic config
git config --global user.name "Fadhil"
git config --global user.email "fadhil@boldstep.my"

# Clone — repo guna HTTPS public (kalau private, guna Personal Access Token)
cd ~
git clone https://github.com/<username>/BoldStepMvp.git boldstep
cd boldstep/BoldStepv1\ MVP/   # nama folder dengan space — guna quote dalam shell
```

> Kalau repo private: GitHub → Settings → Developer settings → Personal access tokens → Generate (scope: `repo`) → guna token sebagai password semasa clone, atau set remote `https://<token>@github.com/...`.

---

## Bahagian F — .env.hermes Template

Buat `~/.env.hermes` (di luar repo supaya `git pull` tak sentuh):

```bash
cat > ~/.env.hermes << 'EOF'
# ── Required ──────────────────────────────────────────────
HERMES_API_KEY=boldstep_sk_hermes_paste_your_key_here
BOLDSTEP_API_URL=https://bold-stepv1-mvp.vercel.app

# ── Schedule ──────────────────────────────────────────────
# 0 = ikut frequency dalam dashboard (Settings Hermes: 6h/12h/24h)
# Set nombor untuk override, cth 6 = setiap 6 jam
HERMES_INTERVAL_HOURS=0

# ── Optional: analisis GLM sebenar (tanpa ni = heuristik) ─
GLM_API_KEY=
GLM_API_BASE=https://api.z.ai/api/paas/v4
GLM_MODEL=glm-5.2
EOF

chmod 600 ~/.env.hermes   # hanya owner boleh baca
```

**Kunci yang dipakai agent** (dari kod `hermes/agent.mjs`):

| Var | Wajib | Fungsi |
|---|---|---|
| `HERMES_API_KEY` | ✅ | Bearer auth ke app — nilai SAMA dengan Vercel env |
| `BOLDSTEP_API_URL` | ✅ | Base URL app Vercel |
| `HERMES_INTERVAL_HOURS` | — | 0 = ikut dashboard frequency |
| `GLM_API_KEY` | — | Analisis model sebenar; kosong = heuristik tempatan |

---

## Bahagian G — pm2 Setup (`npm run hermes:watch`)

### G1. Uji satu kitaran dahulu

```bash
cd ~/boldstep/BoldStepv1\ MVP/
set -a; source ~/.env.hermes; set +a
node hermes/agent.mjs --once
```

Output yang diharapkan:
```
[hermes] agent starting — API at https://bold-stepv1-mvp.vercel.app, mode: single cycle
[hermes] cycle start — ...
[hermes] N account(s), frequency=..., auto_execute=...
[hermes] <account>: synced N rows (mock|live)
[hermes] cycle done — ...
```

### G2. Daftar dengan pm2

```bash
pm2 start hermes/agent.mjs --name hermes-agent
pm2 save

# Startup on boot — copy command yang pm2 print dan jalankan
pm2 startup
# (jalankan command sudo yang dipaparkan)

# Load env vars — edit config: pm2 perlu env dari ~/.env.hermes
pm2 delete hermes-agent
pm2 start hermes/agent.mjs --name hermes-agent --env production -- /bin/bash -c 'set -a; source ~/.env.hermes; set +a; exec node hermes/agent.mjs'
```

Hmm — cara paling bersih dengan env: guna `ecosystem file`:

```bash
cat > ~/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [
    {
      name: 'hermes-agent',
      script: 'hermes/agent.mjs',
      cwd: process.env.HOME + '/boldstep/BoldStepv1 MVP',
      env: {
        HERMES_API_KEY: 'boldstep_sk_hermes_paste_your_key_here',
        BOLDSTEP_API_URL: 'https://bold-stepv1-mvp.vercel.app',
        HERMES_INTERVAL_HOURS: '0',
        GLM_API_BASE: 'https://api.z.ai/api/paas/v4',
        GLM_MODEL: 'glm-5.2',
        GLM_API_KEY: '',
      },
    },
  ],
};
EOF

pm2 start ~/ecosystem.config.cjs
pm2 save
pm2 startup   # jalankan command sudo yang dipaparkan
```

Perintah operasi harian:

| Perintah | Fungsi |
|---|---|
| `pm2 logs hermes-agent --lines 50` | Tonton log kitaran |
| `pm2 status` | Status proses / uptime |
| `pm2 restart hermes-agent` | Restart selepas ubah env |
| `pm2 flush` | Kosongkan log lama |

### G3. Update agent selepas `git pull`

```bash
cd ~/boldstep/BoldStepv1\ MVP/ && git pull
pm2 restart hermes-agent
```

---

## Bahagian H — Telegram Monitoring Verification

Telegram notification dihantar **oleh app (Vercel)** apabila cadangan difailkan — bukan oleh agent. Persediaan:

1. Dalam `.env.local` lokal (dan **Vercel env vars**) sudah ada slot:
   - `TELEGRAM_BOT_TOKEN` — cipta bot via @BotFather (`/newbot`), salin token
   - `TELEGRAM_CHAT_ID` — hantar mesej ke bot, kemudian dapatkan ID via `https://api.telegram.org/bot<TOKEN>/getUpdates` (cari `chat.id`)
2. Set kedua-dua di Vercel → Redeploy
3. **Uji hujung-ke-hujung:** jalankan `npm run hermes` dari PC (dengan env vars export seperti Bahagian A), tunggu kitaran selesai, semak Telegram — sepatutnya terdapat mesej "New action needs approval" dengan pautan persetujuan jika heuristik mencadangkan tindakan (cth: CPL naik ≥40%)
4. Semak juga `PendingApprovals` di dashboard owner — cadangan mesti muncul di sana

**Ujian litar penuh pada VPS:**

```bash
ssh hermes-vps
pm2 logs hermes-agent --lines 20
# Tunggu kitaran seterusnya (atau pm2 restart untuk segera)
# Kemudian semak: Telegram + dashboard Pending Approvals
```

---

## Bahagian I — Troubleshooting

| Simptom | Sebab & penyelesaian |
|---|---|
| `HERMES_API_KEY is not set` | env tak termuat — semak `pm2 env hermes-agent`, restart selepas edit ecosystem file |
| `401/403` pada semua panggilan | Nilai key di VPS ≠ Vercel — pastikan sama tepat (tiada spasi/quote) |
| `POST /api/meta/sync -> 400` | `client_id` hilang — ini tak patut berlaku; semak versi agent = branch main terkini |
| Kitaran kosong (`0 account(s)`) | App tak jumpa akaun — pastikan sudah tambah akaun di dashboard production & `/api/health` menunjukkan `firestore: true` |
| `GLM failed ... falling back to heuristic` | GLM key kosong/salah — tanpa kunci ia berjalan dalam heuristik (selamat, bukan ralat) |
| VPS reboot, agent tak jalan | `pm2 startup` belum dijalankan — ulang Bahagian G2 |

---

## Ringkasan Kos

| Item | Kos |
|---|---|
| Tencent Lighthouse Singapore 1C/1G/25GB | ~USD 5–7/bulan (RM 25–35) |
| Vercel (Hobby) | Percuma |
| Firebase (Spark) | Percuma sehingga had |
| **Jumlah bulanan** | **~RM 25–35** |

> Nota: anggaran RM7-10/bulan dalam keputusan sebelum ini adalah terlalu optimistik untuk Tencent SG — harga sebenar Lighthouse SG bundle termurah sekitar USD 5+/bln. CVM 1C1G lebih mahal. Kalau bajet ketat, alternatif: Oracle Cloud Free Tier (percuma, tapi signup kadang susah), atau LightNode/RackNerd promo (~USD 10/tahun).

---

## Checklist Terakhir

- [ ] `HERMES_API_KEY` sama di Vercel + `.env.hermes`/ecosystem
- [ ] App Vercel dah redeploy selepas tambah key
- [ ] SSH key-only login aktif, fail2ban berjalan
- [ ] `node hermes/agent.mjs --once` berjaya dari VPS
- [ ] pm2 `online`, `pm2 save` + `startup` dilakukan
- [ ] Ujian Telegram diterima selepas kitaran
- [ ] Cadangan muncul dalam Pending Approvals dashboard
- [ ] Backup kunci: `.env.hermes` + private key SSH disimpan selamat
