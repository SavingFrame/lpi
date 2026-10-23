# Home Assistant notifications

Optional iPhone alerts use your existing Home Assistant Companion app, not lpi's own APNs
credentials. Add this block to `lpi.config.json` (omit it to disable notifications):

```json
"homeAssistant": {
  "url": "https://your-home-assistant-host",
  "service": "mobile_app_your_iphone"
}
```

Use the action name from HA Developer Tools without its `notify.` prefix. Create a long-lived
HA access token for a dedicated user, and provide it to the **relay process** as `LPI_HA_TOKEN`
through your local environment/service secret settings. Alternatively, set `LPI_HA_CREDENTIALS_FILE`
to an absolute path to a private JSON file containing `{"token":"..."}`. The environment token takes
precedence. Keep that file outside the repository with mode 600. Never put tokens in mobile settings,
source, or a browser bundle. Restart the relay after configuration changes. Prefer HTTPS; HTTP is
supported only for trusted private networks.

After a live `agent_settled` event, the relay waits ten seconds and sends an alert only if that
completion is still unread. Reading it in either browser or mobile suppresses the alert. Starting
another run cancels the previous pending alert; a newer completion gets a fresh ten-second delay.
Stopped/failed runs also count as completions. Reconnects and saved history do not send alerts.
Pending alerts are memory-only and discarded on relay restart. Failures are logged without credentials
or response bodies and are not retried. Requests time out after ten seconds; at most 32 alerts wait
and eight requests are in flight, with excess alerts skipped. Delivery is not guaranteed. The session
name is the notification title, with up to 200 characters of the final answer as the body (common
Markdown formatting stripped). Thinking and tool output are excluded; runs without answer text use
a generic completion message. Session titles and answer previews are sent to HA and may appear on
the lock screen. A connection-path icon uses lpi's blue palette on supported iOS Companion app
versions; iOS controls the banner appearance. Notification tags replace earlier alerts for the same
session where HA supports it.

Tap links use `lpi:///?session=<inventory-session-id>` and select that session on the mobile
app's **currently configured relay**. They never start/resume Pi or change the server address.
Install a native lpi build to register `lpi://`; Expo Go does not register lpi's custom scheme.
See [manual mobile testing](#manual-mobile-testing) for the HA test and
[mobile session links](../mobile/README.md#notification-session-links) for the Expo Go alternative. iOS opens Home Assistant first, then redirects to lpi;
the first handoff may require confirmation. The action button uses the same handoff.

## Manual mobile testing

After configuring the relay and HA Companion notifications, test this in HA Developer Tools
using a real inventory ID from lpi's `/sessions` API (not Pi's separate session ID):

```yaml
action: notify.mobile_app_your_iphone
data:
  title: lpi
  message: Agent finished answering
  data:
    url: "lpi:///?session=<inventory-session-id>"
    actions:
      - action: OPEN_LPI
        title: Open session
        uri: "lpi:///?session=<inventory-session-id>"
```

Verify body-tap handoff and the explicit Open session action separately with the phone locked,
lpi backgrounded, and lpi closed. Also test while another session, settings, or the drawer is open.
The relay must be reachable when reading the session. iOS Focus and notification settings still
apply. iOS opens Home Assistant before redirecting to lpi, including when using the action button;
the first handoff may ask for confirmation. Automatic backend alerts wait ten seconds and are
suppressed if that completion has been read in either client. No mobile rebuild is needed to
change this server-side behavior.
