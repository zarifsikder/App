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

// Builds ডিরেক্টরি তৈরি
fs.ensureDirSync(path.join(__dirname, 'apks'));
fs.ensureDirSync(path.join(__dirname, 'tmp'));

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'Wevlo Android Builder', version: '1.0.0' });
});

// APK Build Endpoint
app.post('/build', async (req, res) => {
    const { build_id, app_name, package_name, version_name, version_code, type, code } = req.body;

    if (!app_name || !package_name || !code) {
        return res.status(400).json({ status: 'error', message: 'Missing required fields' });
    }

    // Package name validation
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(package_name)) {
        return res.status(400).json({ status: 'error', message: 'Invalid package name' });
    }

    const jobId = uuidv4();
    const workDir = path.join(__dirname, 'tmp', jobId);

    try {
        console.log(`[${jobId}] Build started for ${app_name}`);
        
        // WebView/HTML project — simple wrapper APK
        await fs.ensureDir(workDir);
        
        // এখানে আপনি আসল Android প্রজেক্ট তৈরি করবেন
        // ডেমো হিসেবে আমরা একটি ফাইল তৈরি করছি
        const apkFileName = `${app_name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.apk`;
        const apkPath = path.join(__dirname, 'apks', apkFileName);
        
        // ডেমো APK (আসল সিস্টেমে Gradle build করবে)
        await fs.writeFile(apkPath, 'DEMO APK CONTENT - Replace with real build');
        
        // 2 সেকেন্ড ওয়েট (ডেমো)
        await new Promise(r => setTimeout(r, 2000));
        
        // Cleanup
        await fs.remove(workDir);

        const apkUrl = `${req.protocol}://${req.get('host')}/apks/${apkFileName}`;
        
        console.log(`[${jobId}] Build completed: ${apkUrl}`);
        
        res.json({
            status: 'success',
            message: 'APK built successfully',
            apk_url: apkUrl,
            build_id: build_id,
            log: `Build ${jobId} completed successfully`
        });

    } catch (err) {
        console.error(`[${jobId}] Build failed:`, err);
        await fs.remove(workDir).catch(() => {});
        res.status(500).json({
            status: 'error',
            message: 'Build failed: ' + err.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Wevlo Android Builder running on port ${PORT}`);
});
