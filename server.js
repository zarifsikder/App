const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use('/apks', express.static(path.join(__dirname, 'apks')));

fs.ensureDirSync(path.join(__dirname, 'apks'));
fs.ensureDirSync(path.join(__dirname, 'tmp'));
fs.ensureDirSync(path.join(__dirname, 'templates'));

// ========== Health Check ==========
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'Wevlo Android Builder', 
        version: '2.0.0',
        docker: true 
    });
});

// ========== Helper: Shell Command ==========
function runCmd(cmd, cwd = __dirname) {
    return new Promise((resolve, reject) => {
        exec(cmd, { cwd, maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
            if (err) reject({ error: err.message, stdout, stderr });
            else resolve({ stdout, stderr });
        });
    });
}

// ========== APK Build Endpoint ==========
app.post('/build', async (req, res) => {
    const { build_id, app_name, package_name, version_name, version_code, type, code } = req.body;

    // Validation
    if (!app_name || !package_name || !code) {
        return res.status(400).json({ status: 'error', message: 'Missing required fields' });
    }
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(package_name)) {
        return res.status(400).json({ status: 'error', message: 'Invalid package name' });
    }

    const jobId = uuidv4();
    const workDir = path.join(__dirname, 'tmp', jobId);
    const log = [];

    try {
        console.log(`[${jobId}] Build started: ${app_name}`);
        await fs.ensureDir(workDir);

        // Package name থেকে folder structure
        const pkgPath = package_name.replace(/\./g, '/');
        const cleanAppName = app_name.replace(/[^a-zA-Z0-9 ]/g, '');
        const safeFileName = app_name.replace(/[^a-zA-Z0-9]/g, '_');

        // ============ ১. প্রজেক্ট স্ট্রাকচার তৈরি ============
        log.push('📁 Creating project structure...');
        
        const appDir = path.join(workDir, 'app');
        await fs.ensureDir(path.join(appDir, 'src', 'main', 'java', pkgPath));
        await fs.ensureDir(path.join(appDir, 'src', 'main', 'res', 'values'));
        await fs.ensureDir(path.join(appDir, 'src', 'main', 'res', 'layout'));
        await fs.ensureDir(path.join(appDir, 'src', 'main', 'res', 'mipmap-hdpi'));
        await fs.ensureDir(path.join(workDir, 'gradle', 'wrapper'));

        // ============ ২. build.gradle (Project) ============
        const projectGradle = `
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.1.0'
        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.0'
    }
}
allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
`;
        await fs.writeFile(path.join(workDir, 'build.gradle'), projectGradle);

        // ============ ৩. build.gradle (App) ============
        const appGradle = `
plugins {
    id 'com.android.application'
    id 'org.jetbrains.kotlin.android'
}
android {
    namespace '${package_name}'
    compileSdk 34
    defaultConfig {
        applicationId "${package_name}"
        minSdk 21
        targetSdk 34
        versionCode ${version_code || 1}
        versionName "${version_name || '1.0'}"
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = '17'
    }
}
dependencies {
    implementation 'androidx.core:core-ktx:1.12.0'
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.11.0'
    ${type === 'webview' ? "// WebView" : ""}
}
`;
        await fs.writeFile(path.join(appDir, 'build.gradle'), appGradle);

        // ============ ৪. settings.gradle ============
        await fs.writeFile(path.join(workDir, 'settings.gradle'), `
rootProject.name = "${cleanAppName}"
include ':app'
`);

        // ============ ৫. gradle.properties ============
        await fs.writeFile(path.join(workDir, 'gradle.properties'), `
android.useAndroidX=true
android.enableJetifier=true
org.gradle.jvmargs=-Xmx2048m
kotlin.code.style=official
`);

        // ============ ৬. gradle-wrapper.properties ============
        await fs.writeFile(path.join(workDir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), `
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.2-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`);

        // ============ ৭. AndroidManifest.xml ============
        const isWebView = type === 'webview';
        const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    ${isWebView ? '<uses-permission android:name="android.permission.INTERNET" />' : ''}
    <application
        android:allowBackup="true"
        android:label="${cleanAppName}"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.Light.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
        await fs.writeFile(path.join(appDir, 'src', 'main', 'AndroidManifest.xml'), manifest);

        // ============ ৮. MainActivity.kt বা WebView Activity ============
        let mainActivity;
        if (isWebView) {
            // WebView Activity
            mainActivity = `package ${package_name}

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()
        // HTML code লোড
        webView.loadDataWithBaseURL(null, HTML_CODE, "text/html", "UTF-8", null)
        setContentView(webView)
    }
    
    companion object {
        const val HTML_CODE = """${code.replace(/"""/g, '\\"\\"\\"').replace(/\\/g, '\\\\')}"""
    }
}
`;
        } else {
            // Native HTML/CSS/JS - WebView ভিত্তিক
            mainActivity = `package ${package_name}

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()
        webView.loadDataWithBaseURL(null, APP_HTML, "text/html", "UTF-8", null)
        setContentView(webView)
    }
    
    companion object {
        const val APP_HTML = """${code.replace(/"""/g, '\\"\\"\\"').replace(/\\/g, '\\\\')}"""
    }
}
`;
        }
        await fs.writeFile(path.join(appDir, 'src', 'main', 'java', pkgPath, 'MainActivity.kt'), mainActivity);

        // ============ ৯. strings.xml ============
        await fs.writeFile(path.join(appDir, 'src', 'main', 'res', 'values', 'strings.xml'), 
`<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${cleanAppName}</string>
</resources>`);

        // ============ ১০. styles.xml ============
        await fs.writeFile(path.join(appDir, 'src', 'main', 'res', 'values', 'styles.xml'), 
`<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.NoActionBar" />
</resources>`);

        // ============ ১১. gradlew স্ক্রিপ্ট ডাউনলোড ============
        log.push('📥 Downloading Gradle wrapper...');
        await runCmd(`wget -q https://raw.githubusercontent.com/gradle/gradle/v8.2.0/gradlew -O gradlew`, workDir);
        await runCmd(`wget -q https://raw.githubusercontent.com/gradle/gradle/v8.2.0/gradlew.bat -O gradlew.bat`, workDir);
        await runCmd(`wget -q https://raw.githubusercontent.com/gradle/gradle/v8.2.0/gradle/wrapper/gradle-wrapper.jar -O gradle/wrapper/gradle-wrapper.jar`, workDir);
        await runCmd(`chmod +x gradlew`, workDir);

        // ============ ১২. APK Build ============
        log.push('🔨 Building APK with Gradle...');
        log.push('⏳ This may take 2-5 minutes...');
        
        const buildResult = await runCmd(`./gradlew assembleDebug --no-daemon --console=plain`, workDir);
        log.push('✅ Gradle build completed');

        // ============ ১৩. APK ফাইল খুঁজুন ============
        const apkBuildPath = path.join(appDir, 'build', 'outputs', 'apk', 'debug');
        const files = await fs.readdir(apkBuildPath);
        const apkFile = files.find(f => f.endsWith('.apk'));
        
        if (!apkFile) throw new Error('APK file not found after build');

        // ============ ১৪. APK কপি করুন ============
        const finalApkName = `${safeFileName}_${Date.now()}.apk`;
        const finalApkPath = path.join(__dirname, 'apks', finalApkName);
        await fs.copy(path.join(apkBuildPath, apkFile), finalApkPath);

        // ============ ১৫. Cleanup ============
        await fs.remove(workDir);

        const apkUrl = `${req.protocol}://${req.get('host')}/apks/${finalApkName}`;
        
        console.log(`[${jobId}] ✅ Build successful: ${apkUrl}`);
        
        res.json({
            status: 'success',
            message: 'APK built successfully',
            apk_url: apkUrl,
            build_id: build_id,
            log: log.join('\n')
        });

    } catch (err) {
        console.error(`[${jobId}] ❌ Build failed:`, err);
        await fs.remove(workDir).catch(() => {});
        res.status(500).json({
            status: 'error',
            message: 'Build failed: ' + (err.message || JSON.stringify(err)),
            log: log.join('\n') + '\n\nError: ' + JSON.stringify(err)
        });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Wevlo Android Builder v2.0 running on port ${PORT}`);
    console.log(`📦 Android SDK: ${process.env.ANDROID_SDK_ROOT}`);
    console.log(`☕ Java: ${process.env.JAVA_HOME}`);
});
