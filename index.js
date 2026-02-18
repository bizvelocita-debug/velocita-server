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
    balance: { type: Number, default: 0.00 }, // ₹ Rupee
    totalData: { type: Number, default: 0 },  // MB mein save hoga
    upiId: { type: String, default: "" },
    referralCode: { type: String, unique: true }, 
    referredBy: { type: String, default: null }, 
    lastActive: { type: Date, default: Date.now },
    joinedAt: { type: Date, default: Date.now }
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
    res.send("VELOCITA INDIAN SERVER IS ONLINE 🇮🇳");
});

// 🔥 A. PING (Asli 50-50 Profit Split SDK Model) 🔥
app.post('/ping', async (req, res) => {
    // Ab Flutter app se 'usage' aayega (MBs mein) ki user ne kitna data share kiya hai
    const { deviceId, usage } = req.body; 
    const usageMB = usage || 0; // Agar usage pass nahi hua toh 0 maan lo

    if (!deviceId) return res.status(400).json({ error: "No ID" });

    try {
        let user = await User.findOne({ deviceId });

        // Agar naya user hai toh usko banakar database mein daalo
        if (!user) {
            const baseName = deviceId.split('@')[0].toUpperCase();
            const generatedCode = "VELO-" + baseName;
            
            user = new User({ deviceId, referralCode: generatedCode });
            await user.save();
            console.log(`🆕 NEW USER: ${deviceId}`);
        }

        const now = new Date();
        const diff = (now - new Date(user.lastActive)) / 1000;
        
        // Agar user ne thoda bhi data share kiya hai (usageMB > 0)
        if (usageMB > 0) { 
            // 🧮 MATHEMATICS OF 50% PROFIT:
            // Pawns.app hume deta hai: ₹16 per GB (1024 MB)
            // User ka hissa (50%): ₹8 per GB 
            // Iska matlab 1 MB ka rate hua = ₹8 / 1024 = ₹0.0078125
            
            const ratePerMB = 0.0078125;
            const earning = usageMB * ratePerMB; 
            
            user.balance += earning; // Earning add ki
            user.totalData += usageMB; // Total data update kiya

            // 🎁 Referral Commission (10%) - Aapki jeb se nahi, balki us 100% pie ke earning wale hisse se
            if (user.referredBy) {
                const upline = await User.findOne({ deviceId: user.referredBy });
                if (upline) {
                    upline.balance += (earning * 0.10);
                    await upline.save();
                }
            }
        } else if (diff > 8) {
            // BACKUP: Agar abhi app testing mode mein hai aur usage pass nahi kar rahi,
            // Toh purana 0.01 wala system chalu rakho taaki dashboard khali na dikhe
            const testEarning = 0.01; 
            user.balance += testEarning;
            
            if (user.referredBy) {
                const upline = await User.findOne({ deviceId: user.referredBy });
                if (upline) {
                    upline.balance += (testEarning * 0.10);
                    await upline.save();
                }
            }
        }
        
        user.lastActive = now;
        await user.save();

        res.json({ 
            status: "active", 
            balance: user.balance.toFixed(4), // Accuracy ke liye 4 decimal points
            upiId: user.upiId,
            totalDataShared: user.totalData.toFixed(2)
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server Error" });
    }
});

// B. WITHDRAW REQUEST
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

// C. BIND REFERRAL
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

// D. DELETE USER
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

// 🔥 NAYA FIX: Smart File Finder Route
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

// 2. Protect Admin APIs
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
