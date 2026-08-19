# BOLDSTEP PROJECT — COMPLETE CONTEXT & STATUS
**Last Updated: Aug 19, 2026 — 2:30 PM (Post-Hermes Integration)**

---

## 🎯 BOLDSTEP OBJECTIVE

- **Personal use only** — Fadhil monitor own Meta ads
- **Owner-only system** — Clients see reports only (read-only, no payment)
- Core purpose: Monitor + Analyze + Suggest next steps
- NOT a multi-client agency tool (misunderstood early on)

---

## 🏗️ ARCHITECTURE (CURRENT — Post-Hermes Integration)

### Technology Stack
| Layer | Tool | Status |
|-------|------|--------|
| Frontend/Backend | Next.js 15 (Vercel) | ✅ Live |
| Database | Firebase Firestore | ✅ Live + indexed |
| Storage | Firebase Storage | ✅ Live |
| AI/LLM | GLM 5.2 via Z.ai API | ✅ Live |
| LLM Fallback | Claude API | ⚠️ Not configured (optional) |
| Notifications | Telegram Bot | ✅ Live |
| Ads API | Meta Marketing API | ✅ Live (token in Firestore) |
| Automation | Hermes Cronjobs (script-only) | ✅ Live |
| ~~VPS Agent~~ | ~~Tencent Cloud (pm2)~~ | ❌ REMOVED Aug 19 |

### System Topology (NEW — No VPS)
```
Fadhil's PC
├─ Local dev: npm run dev (:3000)
├─ Git repo: GitHub (BoldStepv1-MVP-)
└─ Hermes Cronjobs (script-only, 0 LLM tokens)
    ├─ Analysis Cycle (every 6h) → Boldstep API
    ├─ Daily Cleanup (8am daily) → cleanup script
    └─ Health Monitor (every 30m) → /api/health

Vercel (Production)
├─ Next.js backend + frontend
├─ Firebase integration
├─ API endpoints (/api/...)
├─ Atomic dedupe (Firestore transaction)
├─ GLM 5.2 analysis (Z.ai)
└─ Telegram notifications (per-action)

Firebase (boldstep-v1)
├─ Firestore (clients, campaigns, insights, pending_actions)
├─ Storage (creatives, reports)
└─ Indexes (deployed Aug 19)
```

### Key Architecture Decision: VPS Removed
The standalone VPS agent (Tencent Cloud, pm2) was the root cause of:
- 600+ duplicate pending actions (race condition)
- Coordination hell (2 systems, 2 deployments)
- Silent crash-loop potential
- Code drift between VPS and Vercel

**Solution:** Hermes cronjobs (script-only, `no_agent: true`) replace it entirely.
- Scripts run directly, 0 LLM tokens
- Call Boldstep API (Vercel) — same endpoints as dashboard
- Telegram notifications sent via Boldstep bot token directly
- No VPS, no pm2, no second codebase to maintain

---

## ✅ ALL ISSUES RESOLVED (Aug 19)

### Issue #1: Race Condition in Dedupe — FIXED ✅
**Root Cause:** POST /api/approvals checked for existing action, then created — NOT atomic.
Two concurrent callers (agent + Run Now, multi-instance) could both see "nothing pending" and both create duplicates.

**Fix Applied (Commit 0f76861):**
- Added `findOrCreatePendingAction()` in `src/lib/firestore.ts`
- Uses Firestore `runTransaction()` — read + create in one atomic operation
- The transaction locks the client's action_items collection
- Mock branch keeps same shape for local dev

**Status:** Code fixed ✅ | Deployed to Vercel ✅ | Verified ✅

---

### Issue #2: Cleanup Script Deleting Valid Actions — FIXED ✅
**Root Cause:** `scripts/cleanup-duplicate-actions.mjs` grouped ALL actions (pending + executed + rejected) by `campaign_id|action_type`, kept oldest, deleted rest. This could delete a newer valid pending action while keeping an old resolved one.

**Fix Applied (Commit 0f76861):**
- Cleanup now only deduplicates PENDING actions
- Resolved actions (executed/rejected) are skipped entirely
- Comment updated: "Only PENDING actions are de-duplicated"

**Status:** Code fixed ✅ | Verified — 755 old duplicates cleaned ✅

---

### Issue #3: from_model Wrong in Heuristic Fallback — FIXED ✅
**Root Cause:** `hermes/agent.mjs` line 281 set `from_model: 'glm'` even when GLM failed and heuristic fallback was used. `model` was correctly `'heuristic'` but `from_model` was wrong — corrupting data integrity.

**Fix Applied (Commit 0f76861):**
- Changed `from_model: 'glm'` → `from_model: 'heuristic'` in fallback branch

**Status:** Code fixed ✅

---

### Issue #4: Hardcoded Windows Path in Cleanup Script — FIXED ✅
**Root Cause:** `scripts/cleanup-duplicate-actions.mjs` line 59 had:
`'file://C:/Users/Admin/Desktop/.../node_modules/firebase-admin/lib/index.js'`
Only works on Fadhil's PC. Would fail on VPS or any other machine.

**Fix Applied (Commit 0f76861):**
- Replaced with dynamic `await import('firebase-admin')`

**Status:** Code fixed ✅

---

### Issue #5: Run Now Bypassed POST /api/approvals — FIXED ✅
**Root Cause:** `POST /api/hermes/run` called `createPendingAction()` directly, bypassing POST /api/approvals. Two separate dedupe implementations that could drift. Run Now never fired webhooks.

**Fix Applied (Commit 0f76861):**
- Created shared service: `src/lib/approval-service.ts`
- `filePendingAction()` = atomic dedupe + create + notify + webhook
- Both POST /api/approvals and POST /api/hermes/run now use this single path
- Run Now now fires webhooks (`action.created`) consistently

**Status:** Code fixed ✅ | Single source of truth ✅

---

### Issue #6: GLM Model Version Mismatch — NOTED ℹ️
**Root Cause:** Context document said "GLM 5.3 (primary)" but code uses `glm-5.2`.
**Finding:** Code is correct. `env.ts` comment: "glm-5.3 is Coding-Plan-only for now; glm-5.2 is the flagship available through the public API."
**Status:** Code correct ✅ | This document updated to reflect reality

---

### Issue #7: listPendingActions Filtered In-Memory — FIXED ✅
**Root Cause:** `listPendingActions()` read ALL actions from Firestore, then filtered `status` in JavaScript. Wasted reads, higher cost.

**Fix Applied (Commit 0f76861):**
- Pushed `status` filter to Firestore query: `.where('status', '==', status)`
- Reads only matching documents, not everything

**Status:** Code fixed ✅

---

### Issue #8: Agent Crash-Loop Silent Failure — FIXED ✅
**Root Cause:** `hermes/agent.mjs` `tick()` called `intervalMs()` without try-catch. If `intervalMs()` threw (settings API down), `setTimeout` never called → agent silently died forever.

**Fix Applied (Commit 0f76861):**
- Wrapped `intervalMs()` in try-catch with 24h fallback
- Agent always schedules next cycle, even if settings API is unreachable

**Status:** Code fixed ✅ (Note: agent.mjs no longer deployed to VPS, but fix remains for reference)

---

### Issue #9: Health Check Misleading meta_ads — FIXED ✅
**Root Cause:** `/api/health` checked `env.meta.isConfigured` which reads `META_AD_ACCOUNT_ID` from `.env.local` (placeholder `act_XXXXXXXXX`). But the real token lives in Firestore (set via dashboard). Health check showed `meta_ads: false` even when Meta was fully working.

**Fix Applied (Commit 1696b72):**
- Health route now also scans Firestore for at least one client with `access_token_encrypted` + `ad_account_id`
- If found, `meta_ads: true` regardless of `.env.local` placeholder

**Status:** Code fixed ✅ | Verified: `meta_ads: true` in production ✅

---

### Issue #10: HERMES_API_KEY Mismatch — RESOLVED ✅
**Root Cause:** `HERMES_API_KEY` in `.env.local` didn't match Vercel env var. API returned 401 for all cronjob calls.
**Resolution:** Key synced — both now use `boldstep_sk_hermes_test_20260819_fadhil`. Vercel redeployed.
**Status:** Resolved ✅ | Auth working ✅

---

### Original Issues (from earlier context, still resolved):
- Issue: 50+ Duplicate Pending Approvals → Fixed (dedupe + atomic transaction)
- Issue: documentPath 'MT Leads 11/8' 500 Error → Fixed (getCampaign returns null for invalid paths)
- Issue: Main Account Section Has No Management Buttons → Fixed by Kilocode
- Issue: Date Filters Incomplete → Fixed by Kilocode

---

## 🤖 HERMES AUTOMATION LAYER

### 3 Cronjobs (Script-Only, 0 LLM Tokens)

| Cronjob | Job ID | Schedule | Script | Function |
|---------|--------|----------|--------|----------|
| Analysis Cycle | 77e16f13498d | Every 6h | `boldstep-analysis-cycle.py` | Sync Meta → POST /api/hermes/run → Telegram summary |
| Daily Cleanup | 1fc33218cc12 | 8am daily | `boldstep-cleanup.py` | Run cleanup-duplicate-actions.mjs → alert if dupes |
| Health Monitor | 6a2f85045ee4 | Every 30m | `boldstep-health-monitor.py` | Check /api/health → alert if critical down |

### Script Locations
- Hermes scripts: `~/AppData/Local/hermes/scripts/`
- Project scripts: `BoldStepv1(MVP)/scripts/` (cleanup-duplicate-actions.mjs, check-clients.mjs)

### How They Work
1. Read `.env.local` for HERMES_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
2. Call Boldstep API (Vercel) using `urllib` (Python stdlib, no deps)
3. Send Telegram notifications directly via Boldstep bot token
4. Silent on success (only alert on errors/actions filed)
5. `no_agent: true` — scheduler runs script, no LLM, 0 tokens

### Telegram Notification Rules
| Event | Who sends | When |
|-------|-----------|------|
| Action filed (per suggestion) | Boldstep API (Vercel) | When GLM files a new pending action |
| Cycle summary | Hermes script | After all clients analyzed |
| Cleanup alert | Hermes script | Only if duplicates found |
| Health alert | Hermes script | Only if RED/YELLOW |
| Execution result | Boldstep API (Vercel) | After approve/reject in dashboard |

---

## 📊 DAILY RESOURCE USAGE (24h)

| Service | Daily Usage | Cost |
|---------|-------------|------|
| Hermes LLM | **0 tokens** (script-only) | RM 0 |
| GLM 5.2 (Z.ai) | ~1,640 tokens (4 calls × ~410 tokens) | Very low |
| Firestore | ~69 reads + ~4 writes (0.14% free tier) | Free |
| Vercel | ~56 API calls | Free tier |
| Meta Graph API | ~4 sync calls (1 per 6h cycle) | Free |
| Telegram | ~0 messages (normal, alerts only) | Free |

---

## 🔧 GIT HISTORY (Key Commits)

| Commit | Date | Description |
|--------|------|-------------|
| `4409736` | Aug 19 | Add cronjob scripts (analysis, cleanup, health) |
| `1696b72` | Aug 19 | Fix misleading health check: meta_ads now checks Firestore |
| `0f76861` | Aug 19 | Fix race condition, cleanup safety, shared approval service, agent hardening |
| `5ec4bd5` | Aug 19 | Fix duplicate approvals and documentPath 500 (original fix) |
| `a81f42e` | Aug 18 | Add Firestore collection-group index for action_items.id |

---

## 🔐 ENVIRONMENT VARIABLES

### Vercel (Production) — must match .env.local
```
HERMES_API_KEY=boldstep_sk_hermes_test_20260819_fadhil
META_AD_ACCOUNT_ID=act_XXXXXXXXX  (placeholder — token lives in Firestore per-account)
GLM_API_KEY=*** (Z.ai API key)
GLM_API_BASE=https://api.z.ai/api/paas/v4
GLM_MODEL=glm-5.2
TELEGRAM_BOT_TOKEN=***
TELEGRAM_CHAT_ID=***
FIREBASE_PROJECT_ID=boldstep-v1
FIREBASE_CLIENT_EMAIL=***
FIREBASE_PRIVATE_KEY=***
FIREBASE_STORAGE_BUCKET=***
JWT_SECRET=*** (required in production)
ENCRYPTION_KEY=*** (required in production, separate from JWT_SECRET)
NEXT_PUBLIC_APP_URL=https://bold-stepv1-mvp.vercel.app
```

### .env.local (Local Dev)
Same as above but `NEXT_PUBLIC_APP_URL=http://localhost:3000` and `BOLDSTEP_API_URL=http://localhost:3000`.

### Meta Token (NOT in env)
- Lives encrypted in Firestore: `clients/{id}.access_token_encrypted`
- Ad account ID in Firestore: `clients/{id}.ad_account_id`
- Set via dashboard (AccountFormModal)
- Decrypted at runtime by `resolveMetaContext()` in `src/lib/meta-api.ts`

---

## 📋 DEPLOYMENT PROCEDURE (Proven — Aug 19)

### For ANY code change:

```
1. [ ] Make code changes locally
2. [ ] Verify: npx tsc --noEmit (must be clean)
3. [ ] Verify: npx eslint <changed files> (must be clean)
4. [ ] Verify: node --check <any .mjs files>
5. [ ] git add -A && git commit -m "<message>"
6. [ ] git push origin main
7. [ ] Wait for Vercel auto-deploy (~30-60s)
8. [ ] Verify: curl https://bold-stepv1-mvp.vercel.app/api/health
9. [ ] If Firestore indexes changed: firebase deploy --only firestore:indexes
10. [ ] Test end-to-end
```

### No VPS coordination needed
The old procedure required: stop VPS agent → deploy Vercel → git pull VPS → restart agent.
With Hermes cronjobs, there is no VPS. Deploy to Vercel = done.

### If Hermes cronjob scripts change:
Scripts live in `~/AppData/Local/hermes/scripts/` (not in git repo).
Update them directly. Next cron tick picks up the new version automatically.

---

## 🎓 LESSONS LEARNED (Updated Aug 19)

### Original Lessons (still valid):
1. **Always trace actual code** — don't assume from spec
2. **Think systems, not just code** — code + infrastructure + dependencies
3. **Red flags = stop & investigate** — problem reappearing = external cause
4. **Deployment = procedure** — create checklist, follow order
5. **Communication = clarity** — explain WHY, one question at a time

### New Lessons (Aug 19):
6. **Race conditions hide in "working" code** — dedupe that's not atomic will leak duplicates under concurrency. Always use transactions for check-then-create.
7. **Cleanup scripts can cause damage** — a cleanup that groups ALL records (not just pending) can delete valid data. Always scope cleanup to the specific state being deduplicated.
8. **Health checks must check the real source** — checking `.env` for a token that lives in Firestore is misleading. Health check should verify actual runtime state.
9. **Eliminate external dependencies when possible** — the VPS agent was the root cause of coordination hell. Replacing it with script-only cronjobs eliminated the entire class of problems.
10. **Script-only cronjobs save tokens** — `no_agent: true` + Python script = 0 LLM tokens vs ~28,500/day for LLM-driven cronjobs. Use scripts for mechanical tasks, LLM only for reasoning.
11. **Sync before analyze** — analysis on stale data produces stale suggestions. Always sync Meta data before running analysis cycle.

---

## 🎯 PRINCIPLES (Updated)

```
1. CLAUDE NEVER CODES (Hermes does)
   ├─ Hermes (this agent): Diagnose, Plan, Fix, Automate, Coordinate
   ├─ Kilocode: Implementation (when needed)
   └─ Fadhil: Direction, decisions, execution (VPS, Vercel dashboard)

2. ALWAYS TRACE ACTUAL CODE
   ├─ Don't assume from spec
   ├─ Read actual implementation
   └─ Verify hypothesis with logs/data

3. THINK SYSTEMS, NOT JUST CODE
   ├─ Code + Infrastructure + Dependencies = System
   ├─ One change affects all parts
   └─ Coordinate all parts together

4. RED FLAGS = STOP & INVESTIGATE
   ├─ Problem reappears after fix = external cause
   ├─ Same issue repeating = root cause not fixed
   └─ Don't just keep cleaning symptoms

5. DEPLOYMENT = PROCEDURE (simplified)
   ├─ Verify locally (tsc + eslint)
   ├─ Push to GitHub → Vercel auto-deploys
   ├─ Verify health endpoint
   └─ No VPS coordination needed anymore

6. AUTOMATION = SCRIPT-FIRST
   ├─ Use no_agent scripts for mechanical tasks (0 tokens)
   ├─ Use LLM only when reasoning is required
   └─ Sync before analyze, alert only on problems
```

---

## 📈 CURRENT PROJECT STATUS

### ✅ COMPLETED (Phase 1.5 + Hermes Integration)
| Component | Status | Date |
|-----------|--------|------|
| Next.js frontend | ✅ Live | Aug 15 |
| Firebase Firestore | ✅ Live + indexed | Aug 18 |
| Meta sync endpoint | ✅ Working | Aug 18 |
| GLM 5.2 integration (Z.ai) | ✅ Configured | Aug 18 |
| Telegram bot | ✅ Created | Aug 19 |
| Meta token (per-account in Firestore) | ✅ Set | Aug 19 |
| Dedupe bug fix (atomic transaction) | ✅ Fixed + deployed | Aug 19 |
| documentPath fix | ✅ Fixed | Aug 19 |
| Main Account UI | ✅ Buttons added | Aug 19 |
| Date filters | ✅ Added | Aug 19 |
| Health check fix | ✅ Fixed + deployed | Aug 19 |
| Shared approval service | ✅ Created | Aug 19 |
| Hermes cronjobs (script-only) | ✅ Active | Aug 19 |
| VPS agent | ❌ Removed | Aug 19 |
| Firestore 755 duplicates | ✅ Cleaned | Aug 19 |

### ⏳ READY FOR USE
| Task | Status |
|------|--------|
| Approval workflow | ✅ Ready (atomic dedupe, single path) |
| Telegram notifications | ✅ Ready (per-action + summary) |
| Scheduled analysis | ✅ Active (every 6h) |
| Health monitoring | ✅ Active (every 30m) |
| Daily cleanup | ✅ Active (8am daily) |

### 🔮 PHASE 2 (Not Started)
| Feature | Complexity | Notes |
|---------|-----------|-------|
| Multi-objective dashboard | Medium | Support clients with goals other than "leads" |
| Multiple ad accounts per client | High | Currently 1 account per client |
| Database schema redesign | High | If multi-account needed |
| Auto-execute workflow | Medium | Settings flag exists (`auto_execute`), needs testing |
| Claude API fallback | Low | Optional — GLM 5.2 working well |
| Creative rotation automation | Medium | Currently manual review suggestion only |

---

## 💾 KEY CONTACTS & RESOURCES

| Item | Value |
|------|-------|
| ~~VPS IP~~ | ~~43.156.18.194~~ (REMOVED) |
| ~~VPS User~~ | ~~maskulin92~~ (REMOVED) |
| Vercel Project | bold-stepv1-mvp |
| Vercel URL | https://bold-stepv1-mvp.vercel.app |
| GitHub Repo | maskulin92/BoldStepv1-MVP- (private) |
| Firebase Project | boldstep-v1 |
| Local Dev Path | C:\Users\Admin\Desktop\Boldstep\BoldStepMvp\BoldStepv1(MVP) |
| Hermes Scripts | C:\Users\Admin\AppData\Local\hermes\scripts\ |
| GLM Platform | Z.ai (https://api.z.ai/api/paas/v4) |
| GLM Model | glm-5.2 |

---

## 📞 NEXT ACTIONS

**For Fadhil:**
1. Monitor Telegram for first scheduled cycle (next: ~7:30 PM today)
2. If actions filed → review in dashboard → approve/reject
3. Consider Phase 2 features when ready

**For Hermes:**
1. Monitor first scheduled runs (analysis, cleanup, health)
2. If any cronjob fails → alert already configured
3. Ready to help with Phase 2 when Fadhil gives direction

---

**End of Context Document**
**Status: SYSTEM LIVE — ALL CLEAR**
**Last Verified: Aug 19, 2026 — 2:30 PM**
