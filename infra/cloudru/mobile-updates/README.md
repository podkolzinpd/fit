# Android OTA feed (not activated)

`location.conf` is an offline fragment for the existing HTTPS frontend server.
Do not copy it to production or publish bundles until the owner approves the
closed rollout and the new APK has passed native acceptance. Before store
distribution, review current RuStore requirements for this release; this task
does not claim store approval for OTA.
No new cloud resources, account or Capawesome Cloud service are needed.

Artifact layout produced by `npm run android:ota:package -- DIST OUTPUT SHA`:

- `android/bundles/<sha256>.zip`: immutable RSA-signed web archive;
- `android/alpha/<native-abi>/latest.json`: RSA-signed expiring manifest;
- `provenance.json`: source SHA, ABI, exact native version and sequence.

The signing key is supplied only through `FIT_ANDROID_OTA_PRIVATE_KEY_PATH`.
It must have mode0600 and match `config/android-ota-public-key.pem`. Keep a
protected backup independently of the checkout; no private key belongs in Git,
an APK, an artifact, a URL or logs. OTA and APK signing keys are separate.

After approval, use the existing trusted Cloud.ru release process to:

1. Verify the source SHA's **full** successful CI and the APK's embedded public
   key/ABI/code4. Build the web layer with `FIT_ANDROID_OTA_ENABLED=true`,
   `FIT_SOURCE_COMMIT=<sha>` and Cloud.ru `VITE_YANDEX_API_BASE_URL=https://api.fit-training.ru`.
2. Package locally/in a trusted signing context. Re-verify archive SHA256 and
   RSA signature plus manifest signature, ABI, exact APK code and expiry.
3. Install this Nginx fragment inside the existing HTTPS server using its normal
   backup, `nginx -t`, reload and rollback procedure. No API or DB route changes.
4. Copy the archive first to `/var/lib/fit-mobile-updates/android/bundles/` under
   the content-addressed name. Never overwrite a different existing object.
5. Only after download/signature readback, write `latest.json` to a temporary
   file in the same ABI directory and atomically rename it. Manifest is last.
6. Verify HTTP404 for unknown paths, GET/HEAD only, normal TLS validation,
   no-store and CORS `https://localhost`. No tokens/cookies/user identifiers.
7. Test a clean emulator: builtin → download → next cold start → new web UI;
   retain an offline launch; then a deliberately broken **test-only** signed
   bundle → timeout20s → builtin. Never publish the broken fixture in alpha.

Manual rollback uses the same packaging command with `--reset`, creating a
**new sequence** and `release:null`. Existing clients stage builtin on their
next check/cold start; offline clients retain their working installed bundle.
Do not copy an old manifest: clients reject lower sequence numbers. Missing or
expired metadata cannot brick the app and does not delete its existing bundle.
Renew metadata before its30-day expiry with a higher signed sequence if the
release should remain available to new installations.

The native plugin automatically falls back to the APK's builtin web layer when
`ready()` is not called within20s in the foreground and blocks the failed bundle.
It does not promise the last downloaded release as the fallback. Do not call
`reload()` during a workout/voice entry/form: only a later native Activity/WebView bootstrap
activates a staged update. Feed publication is a separate explicit step; it is
not coupled to deploying the public website or its release cleanup.
