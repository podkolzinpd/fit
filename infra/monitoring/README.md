# Fit: monitoring on the existing VM

Status: implementation prepared; installation and Telegram delivery are not yet verified.
No additional cloud resources or application records are created.

The minute systemd timer collects host CPU deltas, available memory, free disk,
API/database readiness, frontend and SpeechKit health, last background worker
result, and the existing verified-backup marker. It retains only technical
counters and alert state in a private local state directory. CPU/memory/disk
alerts require 15 minutes of observed pressure. Other host failures require
2 minutes. Recovery requires 5 healthy minutes. Repeated unchanged conditions
are silent. Gaps over 10 minutes reset pending streaks, not active incidents.
Telegram transitions are committed only after acknowledged delivery; retry after
an ambiguous network failure can produce a duplicate (Telegram has no idempotency key).

External GitHub-hosted checks poll API readiness and frontend every five minutes
(best effort: Actions schedule can be delayed). They need two consecutive failed
observations, about five minutes apart, before sending an incident; recovery also
needs two healthy observations. Durable cache state suppresses repeats. Cache
loss can cause a duplicate incident. A full GitHub outage is outside this monitor.

Configure repository secrets FIT_ALERT_TELEGRAM_BOT_TOKEN and
FIT_ALERT_TELEGRAM_CHAT_ID through secure secret input, never source control.
The owner selected @Rukis_Nakachadze_bot and a private Telegram forum. Existing
feedback integration uses APP_FEEDBACK_TELEGRAM_BOT_TOKEN in the historical
fit-stage-app-feedback-integrations Lockbox secret; its presence and bot identity
must be checked before reuse. Do not change bot permissions or rotate keys as part
of monitoring installation. Test delivery must be acknowledged by Telegram.

After green CI on main, manually dispatch fit-monitor.yml with install_host=true
and test_delivery=true; inspect the Telegram test and installed systemd timer.
Set repository variable FIT_MONITOR_ENABLED=true only after those checks.
Installation changes only /opt/fit-monitor, its private env/state and systemd
monitor units; application services are not restarted. Rollback: disable the
fit-monitor.timer and set FIT_MONITOR_ENABLED=false. Keep state to retain incident
continuity. No auto-scaling, purchases, migrations or application writes.

Not covered yet: API business-route p95/error-rate instrumentation, PostgreSQL
CPU/storage/locks, active video/voice counts, Jitsi cgroup throttling and network
capacity. Readiness is not a substitute for these metrics. The initial monitoring
must not claim all scaling thresholds are implemented.
