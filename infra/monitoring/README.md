# Fit: monitoring on the existing VM

Status: replacement Telegram delivery verified; final installation is pending CI and production read-back.
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
The owner selected @Rukis_Nakachadze_bot and a private Telegram forum. The configured replacement bot was verified by getMe and a successful sendMessage receipt; credentials stay only in GitHub Secrets. Do not change bot permissions or rotate keys as part
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

## External delivery after VM network failure

The VM collector never receives a Telegram token and never contacts Telegram.
It evaluates sustained conditions every minute and saves active incident state.
Every five minutes a bounded self-hosted Actions job exports only timestamp and
known boolean incident flags. A GitHub-hosted job compares that snapshot with its
previous acknowledged state and sends transitions from the external network.
Public checks run independently of the VM export. A failed delivery preserves the
previous state for retry. Snapshot freshness is checked; pending self-hosted jobs
can delay resource notifications if the runner is unavailable. The independent
public checker still detects site/API failure. Actions scheduling is best effort,
not a one-minute availability guarantee.
