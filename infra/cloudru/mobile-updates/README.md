# Android OTA feed

`location.conf` is installed by the main-only `release-android-ota.yml` publisher.
The owner authorized the alpha rollout and fresh signed APK on23.10.2026.
The publisher verifies signatures and immutable archive readback before metadata. Before store
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

## Automatic releases

`FIT_ANDROID_OTA_AUTODEPLOY_ENABLED=true` enables publication after successful
Cloud.ru frontend preparation on green current main. The Android build copies
all web feature flags, with its canonical native API origin. Protected environment
secret `FIT_ANDROID_OTA_PRIVATE_KEY` is used only on the hosted build runner.
Manual inputs `ci_run_id`, `make_apk`, `reset` build APK1.1.1/code5 or publish a
new signed builtin reset. No signing key is uploaded in artifacts or to Nginx.
`node scripts/publish-android-ota.mjs verify|publish|readback DIRECTORY SHA` verifies
source/ABI/nativeBuild, RSA, expiry, sequence and public bytes. The publish command
requires the trusted Cloud.ru runner and preserves existing API/TLS routing.

При новой ABI автоматическая публикация останавливается с `OTA_NATIVE_APK_REQUIRED`;
требуется manual `make_apk=true`, native tests и фактическая подпись нового APK.
Это не выдаётся за доставленное обновление старым оболочкам.
