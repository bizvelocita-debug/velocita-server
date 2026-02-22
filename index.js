const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs'); 

const app = express();
app.use(cors());
app.use(express.json());

// 1. DATABASE CONNECTION
const MONGO_URI = "mongodb+srv://admin:Keshav%402829@cluster0.tcdl2wy.mongodb.net/velocita?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DATABASE CONNECTED (MongoDB) - 🇮🇳 Indian Server"))
    .catch(err => console.error("❌ DB ERROR:", err));

// 2. DATA MODELS
const userSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true }, 
    hardwareId: { type: String, default: null },              
    hasClaimedReferral: { type: Boolean, default: false },    
    balance: { type: Number, default: 0.00 }, 
    totalData: { type: Number, default: 0 },
    upiId: { type: String, default: "" },
    referralCode: { type: String, unique: true }, 
    referredBy: { type: String, default: null }, 
    lastActive: { type: Date, default: Date.now },
    joinedAt: { type: Date, default: Date.now },
    
    // 🛡️ Anti-Hack: Daily Limit Trackers for Tasks
    dailyTaskEarnings: { type: Number, default: 0 },
    lastTaskDate: { type: String, default: "" }
});
const User = mongoose.model('User', userSchema);

const payoutSchema = new mongoose.Schema({
    deviceId: String,
    amount: Number,
    method: String,
    details: String,
    status: { type: String, default: "Pending" },
    date: { type: Date, default: Date.now }
});
const Payout = mongoose.model('Payout', payoutSchema);

// ==========================================
// 🔓 PUBLIC ROUTES (For Flutter App Only)
// ==========================================

app.get('/', (req, res) => {
    res.send("VELOCITA INDIAN SERVER IS ONLINE 🇮🇳 (With Anti-Hack Guard)");
});

// A. PING (Secured Mining Loop)
app.post('/ping', async (req, res) => {
    const { deviceId, usage } = req.body;
    if (!deviceId) return res.status(400).json({ error: "No ID" });

    try {
        let user = await User.findOne({ deviceId });

        if (!user) {
            const baseName = deviceId.split('@')[0].toUpperCase();
            const generatedCode = "VELO-" + baseName;
            
            user = new User({ deviceId, referralCode: generatedCode });
            await user.save();
            console.log(`🆕 NEW USER: ${deviceId}`);
        }

        const now = new Date();
        const diff = (now - new Date(user.lastActive)) / 1000;
        
        // Mining Logic (Background Ping)
        if (diff > 8) { 
            const earning = 0.01; 
            user.balance += earning;

            // Referral Earning Logic
            if (user.referredBy) {
                const upline = await User.findOne({ deviceId: user.referredBy });
                if (upline) {
                    upline.balance += (earning * 0.10);
                    await upline.save();
                }
            }
            user.lastActive = now;
        }

        if (usage) user.totalData = usage;
        await user.save();

        res.json({ 
            status: "active", 
            balance: user.balance.toFixed(4), 
            upiId: user.upiId 
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server Error" });
    }
});

// 🔥 B. UPDATE BALANCE API (For Quiz, Captcha, News - HIGH SECURITY)
app.post('/updateBalance', async (req, res) => {
    const { deviceId, amount, reason } = req.body;
    
    if (!deviceId || amount == null) return res.status(400).json({ error: "Missing data" });

    try {
        const user = await User.findOne({ deviceId });
        if (!user) return res.status(404).json({ error: "User not found" });

        const today = new Date().toISOString().substring(0, 10); // e.g., 2024-05-20

        // Reset daily limit if it's a new day
        if (user.lastTaskDate !== today) {
            user.dailyTaskEarnings = 0;
            user.lastTaskDate = today;
        }

        const requestedAmount = parseFloat(amount);

        // 🛡️ ANTI-HACK: Prevent single abnormal requests (e.g. Someone trying to add ₹500 at once via Postman)
        if (requestedAmount > 2.0) {
            console.log(`🚨 HACK ATTEMPT: ${deviceId} tried to add ₹${requestedAmount} for ${reason}`);
            return res.status(403).json({ error: "Suspicious activity detected!" });
        }

        // 🛡️ ANTI-HACK: Daily Cap (Max ₹15 per day from side tasks)
        if (user.dailyTaskEarnings + requestedAmount > 15.0) {
            console.log(`⚠️ DAILY LIMIT REACHED: ${deviceId} exceeded ₹15 task limit.`);
            return res.status(429).json({ error: "Daily task limit reached." });
        }

        // ✅ If safe, add money
        user.balance += requestedAmount;
        user.dailyTaskEarnings += requestedAmount;
        
        await user.save();

        console.log(`💰 TASK EARNED: ${deviceId} got ₹${requestedAmount} for [${reason}]. New Bal: ₹${user.balance.toFixed(4)}`);
        res.json({ success: true, newBalance: user.balance });

    } catch (e) {
        console.error("Balance Update Error:", e);
        res.status(500).json({ error: "Server Error" });
    }
});

// C. WITHDRAW REQUEST
app.post('/withdraw', async (req, res) => {
    const { deviceId, method, details } = req.body;
    try {
        const user = await User.findOne({ deviceId });
        if (!user) return res.status(404).json({ message: "User not found" });
        
        if (user.balance < 50.0) {
            return res.status(400).json({ message: "Minimum ₹50 required." });
        }

        const newPayout = new Payout({
            deviceId,
            amount: user.balance,
            method,
            details
        });
        await newPayout.save();

        user.upiId = details;
        user.balance = 0; 
        await user.save();

        console.log(`💸 PAYOUT: ₹${newPayout.amount} -> ${deviceId}`);
        res.json({ status: "success", message: "Request Sent!" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// D. BIND REFERRAL
app.post('/bindReferral', async (req, res) => {
    const { deviceId, hardwareId, promoCode } = req.body;
    try {
        if (hardwareId && hardwareId !== "unknown_device") {
            const existingDevice = await User.findOne({ hardwareId: hardwareId, hasClaimedReferral: true });
            if (existingDevice && existingDevice.deviceId !== deviceId) {
                console.log(`🚨 FRAUD BLOCKED: Phone ${hardwareId} trying multiple emails.`);
                return res.status(400).json({ error: "Fraud detected: Device already used a referral code!" });
            }
        }

        let user = await User.findOne({ deviceId });
        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.referredBy || user.hasClaimedReferral) return res.status(400).json({ error: "Already claimed referral" });

        const referrer = await User.findOne({ referralCode: promoCode });
        if (!referrer || referrer.deviceId === deviceId) {
            return res.status(400).json({ error: "Invalid Code or Self-Referral" });
        }

        referrer.balance += 10.00;
        await referrer.save();

        user.referredBy = referrer.deviceId;
        user.hardwareId = hardwareId; 
        user.hasClaimedReferral = true; 
        await user.save();

        console.log(`🎉 REFERRAL SUCCESS: ₹10 added to ${referrer.deviceId}`);
        res.json({ success: true, message: "Referral Applied & Bonus Given!" });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// E. BITLABS S2S WEBHOOK (Survey Paisa Receiver)
app.get('/bitlabs-webhook', async (req, res) => {
    const { uid, val, tx } = req.query; 

    console.log(`🔔 BITLABS ALERT: Survey done! User: ${uid} | Reward: ₹${val} | TX: ${tx}`);

    if (!uid || !val) {
        return res.status(400).send("Missing parameters");
    }

    try {
        const user = await User.findOne({ deviceId: uid });
        
        if (!user) {
            console.log(`❌ ERROR: User ${uid} not found in database.`);
            return res.status(404).send("User not found");
        }

        const rewardAmount = parseFloat(val);
        user.balance += rewardAmount;
        await user.save();

        console.log(`✅ SUCCESS: ₹${rewardAmount} added to ${uid}. New Balance: ₹${user.balance.toFixed(2)}`);

        // BitLabs ko '200 OK' bhejna zaroori hai
        res.status(200).send("OK");

    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send("Internal Server Error");
    }
});

// F. DELETE USER
app.post('/deleteUser', async (req, res) => {
    const { deviceId } = req.body;
    try {
        await User.deleteOne({ deviceId });
        await Payout.deleteMany({ deviceId }); 
        console.log(`🗑️ DELETED USER: ${deviceId}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// ==========================================
// 🔐 SECURE ADMIN ROUTES (Password Protected)
// ==========================================

const adminAuth = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    // 👇 Admin Username aur Password
    const ADMIN_USER = "admin";
    const ADMIN_PASS = "velocita@2026"; 

    if (login === ADMIN_USER && password === ADMIN_PASS) {
        return next(); 
    }

    res.set('WWW-Authenticate', 'Basic realm="Velocita Command Center"');
    res.status(401).send('🛑 ACCESS DENIED! You are not the Admin.');
};

// 🔥 Smart File Finder Route
app.get(['/panel', '/admin', '/dashboard'], adminAuth, (req, res) => {
    const publicPath = path.join(__dirname, 'public', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');

    if (fs.existsSync(publicPath)) {
        res.sendFile(publicPath);
    } else if (fs.existsSync(rootPath)) {
        res.sendFile(rootPath);
    } else {
        res.status(404).send(`
            <h1 style="color: red; text-align: center; margin-top: 50px;">🚨 Error 404: HTML File Missing!</h1>
            <h3 style="text-align: center;">Bhai, server par 'index.html' file nahi mil rahi hai.</h3>
            <p style="text-align: center;">Please check karo ki aapne index.html file ko Render ya Github par sahi se upload kiya hai ya nahi.</p>
        `);
    }
});

// Protect Admin APIs
app.get('/admin/payouts', adminAuth, async (req, res) => {
    const payouts = await Payout.find({ status: "Pending" }).sort({ date: -1 });
    res.json(payouts);
});

app.get('/admin/users', adminAuth, async (req, res) => {
    const users = await User.find().sort({ balance: -1 });
    res.json(users);
});

app.post('/admin/pay', adminAuth, async (req, res) => {
    const { payoutId } = req.body;
    await Payout.findByIdAndUpdate(payoutId, { status: "Paid" });
    res.json({ success: true });
});

// SERVER START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Indian Server running on Port ${PORT}`);
});
