# DubMaster — Subprocessor Register

**Status:** Draft for internal review · **Last updated:** 2026-08-12

A subprocessor is any third party that receives customer data on our behalf.
Under GDPR you must maintain this list, have a Data Processing Agreement with
each, and disclose it to customers. Studios will ask a blunter version of the
same question: **"who else touches my film?"**

Compiled from API keys configured in `Dubverse Backend/.env` and endpoints
referenced in the codebase. **Status** reflects what the code does, not what is
contractually agreed.

---

## Infrastructure

| Service | Data received | Purpose | Status |
|---|---|---|---|
| **Supabase** | Account email, auth identity, job metadata, dialogue segments, subscription state | Auth + database | Active |
| **Cloudflare R2** | Full source video | Object storage | Active |
| **Stripe** | Name, email, card data (direct from customer) | Payments | Active — card data never transits DubMaster |
| **RunPod** | Full source video (via presigned R2 URL) | GPU transcription, separation, diarization | Active |

## AI processors — receive customer audio or dialogue

| Service | Data received | Purpose | Status |
|---|---|---|---|
| **Modulate (Velma)** | Separated vocals (whole track) | Diarization, emotion, scene context | Active — primary |
| **Anthropic (Claude)** | Source + translated dialogue text | Translation, adaptation | Active — primary |
| **ElevenLabs** | Translated text; voice samples if cloning | TTS | Active |
| **Fish Audio** | Translated text; voice samples if cloning | TTS | Active |
| **Respeecher** | Audio for speech-to-speech | TTS alternative | Key configured |
| **Hume** | Audio segments | Emotion analysis | Key configured |
| **Tencent Cloud** | Cantonese audio | Cantonese ASR engine | Key configured — **see jurisdiction note** |
| **DeepL** | Dialogue text | Translation fallback | Key configured |
| **Google Translate** | Dialogue text | Translation fallback | Key configured |
| **OpenAI** | Dialogue text | Translation/adaptation fallback | Referenced in code |
| **Hugging Face** | Model downloads (token only) | pyannote model access | Active — no customer data |
| **Replicate / Vozo / ScreenApp** | Referenced in code | Assorted | Verify whether active |

---

## Actions required

1. **Confirm which are actually in use.** A configured key is not proof of use.
   Anything not used should have its key removed — an unused credential is pure
   liability. Anything used must appear on the customer-facing list.
2. **Execute a DPA with every active subprocessor.** Most publish a standard
   DPA (Stripe, Supabase, Cloudflare, Anthropic, ElevenLabs all do).
3. **Publish a customer-facing subprocessor list** with a change-notification
   commitment. This is a GDPR requirement and the first thing an enterprise
   security review asks for.
4. **Record data residency per vendor** (see below).

---

## Jurisdiction note — read before signing a studio

**Tencent Cloud** is a Chinese provider. Sending customer film audio there has
consequences beyond GDPR transfer mechanics: many studio content-security
agreements restrict which jurisdictions pre-release material may enter, and some
prohibit this one outright.

If the Cantonese ASR path is active, this must be a deliberate, disclosed choice
— not a config default nobody reviewed. The same question applies to any vendor
processing outside the EU/UK/US.

**Recommendation:** confirm whether `CANTONESE_ASR_ENGINES` actually routes to
Tencent in production. If not required, remove the key.

---

## The structural risk

Customer film audio currently reaches **at least four external companies** in a
single dub: RunPod, Modulate, an ASR engine, and a TTS provider — plus Anthropic
for dialogue text. Each is a separate contract, a separate breach surface, and a
separate line on a studio's questionnaire.

That is not automatically wrong — it is how a small team gets this quality — but
it must be *known and defensible*, and right now it is not written down anywhere
a customer could read.
