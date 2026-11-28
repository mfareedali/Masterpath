#!/usr/bin/env bash
# Builds android/out/MastersPath.apk with the Android SDK command-line tools only (no Gradle).
# Usage: bash android/build.sh https://masterpath-six.vercel.app
# Signing key: $MP_KEYSTORE (default ~/.masterspath-android.jks), created on first run. Never commit it.
set -euo pipefail
URL="${1:?site URL}"
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
JAR="$SDK/platforms/android-35/android.jar"
KS="${MP_KEYSTORE:-$HOME/.masterspath-android.jks}"
PASS_FILE="${KS}.pass"
rm -rf out && mkdir -p out/gen out/classes out/res
cat > out/gen/BuildInfo.java <<JAVA
package com.masterspath.app;
final class BuildInfo { static final String URL = "$URL"; }
JAVA
"$BT/aapt2" compile --dir res -o out/res/res.zip
"$BT/aapt2" link -o out/base.apk -I "$JAR" --manifest AndroidManifest.xml out/res/res.zip --java out/gen
javac -source 11 -target 11 -classpath "$JAR" -d out/classes out/gen/com/masterspath/app/R.java out/gen/BuildInfo.java src/com/masterspath/app/MainActivity.java 2>&1 | grep -v "bootstrap classpath" || true
"$BT/d8.bat" --release --lib "$JAR" --output out $(find out/classes -name '*.class')
(cd out && cp base.apk unsigned.apk && jar uf unsigned.apk classes.dex)
"$BT/zipalign.exe" -f -p 4 out/unsigned.apk out/aligned.apk
if [ ! -f "$KS" ]; then
  head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' > "$PASS_FILE"
  keytool -genkeypair -keystore "$KS" -alias masterspath -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$(cat "$PASS_FILE")" -keypass "$(cat "$PASS_FILE")" -dname "CN=MastersPath, O=MastersPath, C=PK" >/dev/null 2>&1
fi
"$BT/apksigner.bat" sign --ks "$(cygpath -w "$KS")" --ks-key-alias masterspath --ks-pass "file:$(cygpath -w "$PASS_FILE")" --out out/MastersPath.apk out/aligned.apk
"$BT/apksigner.bat" verify out/MastersPath.apk && ls -la out/MastersPath.apk
