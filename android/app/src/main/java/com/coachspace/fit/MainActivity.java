package com.coachspace.fit;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.capawesome.capacitorjs.plugins.liveupdate.LiveUpdatePreferences;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Self-hosted ZIP requests do not need a persistent per-device identity.
        // The SDK adds this preference as a header; use one public constant for
        // every installation before the plugin constructs its HTTP client.
        new LiveUpdatePreferences(this).setDeviceId("fit-self-hosted");
        super.onCreate(savedInstanceState);
    }
}
