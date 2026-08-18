# Keputusan Seni Bina — Hermes Agent (Phase 1.5b)

**Tarikh:** 19 Ogos 2026
**Status:** Menunggu keputusan Fadhil
**Penulis:** Kilo (berdasarkan audit codebase + verification Nous Research)

---

## 1. Latar Belakang

Spesifikasi Phase 1.5b (REVISED) meminta menggantikan custom agent dengan
"Nous Research Hermes Agent Framework". Selepas verification, terdapat satu
fakta seni bina yang mesti difahami sebelum sebarang keputusan:

> **Nous Hermes Agent ialah aplikasi agent standalone (desktop/CLI),
> BUKAN library/SDK.** Ia tidak boleh `npm install` dan dipanggil dari
> dalam Next.js seperti dependency biasa.

Sumber: `nousresearch.com/hermes-agent` — v0.20.4, MIT license, GitHub
`NousResearch/hermes-agent`. Ia ialah "personal AI agent" (seperti Claude Code
open-source) dengan memory, scheduling, subagent, sandboxing, dan connector
ke Telegram/Discord/Slack — bukan enjin keputusan yang expose REST API.

---

## 2. Apa yang SUDAH wujud dalam codebase (jangan buang)

Audit menunjukkan custom agent sedia ada sudah meliputi ~80% keperluan
fungsional spec. Jadual berikut memadankan keperluan spec dengan realiti:

| Keperluan spec | Status | Lokasi |
|---|---|---|
| GLM primary + Claude fallback | ✅ Sedia | `src/lib/glm-client.ts` |
| Scheduled 6h/12h/24h | ✅ Sedia | `hermes/agent.mjs` + `/api/hermes/settings` |
| Confidence score 0-100% | ✅ Sedia | `PendingAction.confidence` (`types/action.ts`) |
| Store ke pending_actions | ✅ Sedia | `POST /api/approvals` |
| Telegram notify | ✅ Sedia | App hantar bila suggestion difailkan |
| Never auto-execute | ✅ Sedia | draft-first; `auto_execute` off default |
| Audit logging | ✅ Sedia | `audit_log` (Phase 1.5c) |
| Learning (track approvals) | ⚠️ Separuh | `hermesMemory` simpan keputusan; adaptasi minimal |
| "Run Now" button | ❌ Tiada | HermesControlPanel cuma tab Chat/Approvals/Memory/Settings |
| ROTATE / OPTIMIZE types | ❌ Tiada | cuma pause/resume/budget_change/analysis |

---

## 3. Dua Laluan

### Laluan A — Integrasi Nous Hermes Agent sebenar

Pasang Nous Hermes Agent di VPS sebagai proses berasingan, kemudian bina
"satu skill" atau MCP server yang ajar ia cara panggil Boldstep REST API
(`POST /api/meta/sync` → baca campaigns → `POST /api/approvals`).

**Cara ia sebenarnya berfungsi:**

```
Nous Hermes Agent (VPS, proses sendiri)
   │  skill/mcp "boldstep" yang kau tulis
   ▼
Boldstep REST API (Vercel)
   ├─ POST /api/meta/sync
   ├─ GET  /api/campaigns/[id]
   └─ POST /api/approvals
```

**Kebaikan:**
- Guna framework agent yang lebih kaya (persistent memory, subagents,
  sandboxing, multi-platform)
- "Authentic" ikut keputusan asal Fadhil
- Memory + learning framework Nous lebih matang untuk pattern detection

**Keburukan:**
- **Effort: 1–3 hari** (bukan 3-4 jam seperti spec anggar) — kena belajar
  sistem skill/MCP Nous, tulis + debug skill Boldstep
- **Risiko versi:** v0.20.4 masih berubah pantas; API skill boleh break
  bila upgrade
- **Dua sistem perlu maintain:** app Next.js + agent Nous + skill di tengah
- **Model:** Nous Hermes Agent guna model sendiri / portal; GLM+Claude
  dual-tier dalam spec kena di-replicate dalam konfigurasi Nous, bukan
  guna semula `glm-client.ts`
- **VPS wajib** (agent Nous tak jalan dalam Vercel serverless)

**Bila pilih ini:** jika Fadhil memang mahu framework agent penuh untuk
use-case masa depan yang lebih kompleks (bukan sekadar analisis iklan),
dan sanggup melabur masa.

---

### Laluan B — Kekalkan custom agent + tambah yang hilang

Kekalkan `hermes/agent.mjs` (sudah diuji 9/9 hujung-ke-hujung), dan tambah
tiga benda yang betul-betul hilang:

1. **"Run Now" button** — trigger kitaran analisis segera dari
   HermesControlPanel (panggil `POST /api/meta/sync` + analisis + failkan
   suggestion, tanpa tunggu jadual)
2. **ROTATE + OPTIMIZE suggestion types** — tambah ke `ActionType` enum +
   heuristik + prompt GLM
3. **Deep learning** — baca `hermesMemory` (keputusan approval lepas) dan
   beri weight kepada jenis suggestion yang Fadhil selalu approve

**Kebaikan:**
- **Effort: ~2 jam** — hasil predictable, testable hari ini
- Guna semula 100% infra sedia ada (glm-client, approvals, telegram,
  audit_log, settings)
- Satu sistem sahaja untuk maintain
- Boleh jalan di Vercel (embedded) ATAU VPS (separate process) — fleksibel
- Tiada risiko dependency luaran berubah

**Keburukan:**
- Bukan "Nous Hermes" sebenar — kalau nama jenama penting, ini tak penuhi
- Learning lebih asas (rule-based weighting, bukan pattern detection NN)
- Kalau masa depan nak agent framework penuh, kena migrate kemudian

**Bila pilih ini:** untuk MVP yang kena jalan sekarang, dengan analisis
iklan yang predictable dan kos terkawal.

---

## 4. Jawapan kepada 4 soalan spec

| Soalan | Cadangan |
|---|---|
| 1. Separate process vs embedded? | **Separate process** (VPS) untuk production; embedded (route handler) untuk MVP testing. Custom agent sudah support kedua-dua. |
| 2. Learning depth? | **Basic dulu** — rule-based weighting dari approval history (count approve/reject per jenis suggestion, bias ke arah yang Fadhil approve). Advanced pattern detection (embedding/ML) ialah fasa kemudian. |
| 3. Confidence threshold? | **Show all, sorted by confidence** — tapi tandakan `< 60%` sebagai "low confidence" supaya Fadhil boleh tapis. Jangan buang suggestion confidence rendah (data learning penting). |
| 4. Context window? | **30 hari default** (7 hari terlalu pendek untuk trend; 90 hari berat untuk setiap kitaran). Buat configurable via `HERMES_RUN_FREQUENCY`-style env. |

---

## 5. Cadangan Saya

**Laluan B untuk MVP sekarang** + **Laluan A sebagai fasa kemudian**.

Sebab:
1. Spec functional requirements dah 80% wujud — buang dan bina semula dengan
   Nous ialah risiko yang tak setimpal dengan nilai untuk MVP
2. "Run Now" + ROTATE/OPTIMIZE + learning ialah nilai sebenar yang Fadhil
   rasa hilang — boleh siap dalam ~2 jam, bukan 3 hari
3. Nous Hermes Agent masih v0.20.4 — integrasi awal akan jadi hutang teknikal
   bila API skill berubah
4. Kalau kemudian Fadhil betul-betul mahu framework penuh, custom agent boleh
   dijadikan "skill" untuk Nous (endpoint REST sudah wujud — just wire)

**Jalan tengah yang disyorkan:** bina Laluan B sekarang (siap cepat), dan
kekalkan `VPS-SETUP.md` + `agent.mjs` supaya Laluan A boleh dihidupkan bila-bila
masa tanpa buang kerja sedia ada.

---

## 6. Keputusan

Sila pilih:

- [ ] **B — teruskan Laluan B sekarang** (Run Now + ROTATE/OPTIMIZE + learning, ~2 jam)
- [ ] **A — mulakan integrasi Nous Hermes Agent** (1-3 hari, VPS wajib)
- [ ] **A+B — Laluan B dahulu, Nous kemudian** (cadangan saya)
- [ ] **Tahan** — bincang lagi / tunggu input lain

Keputusan: ___________________________
