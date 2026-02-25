const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs'); 
const cron = require('node-cron'); // 🔥 NEW: Midnight Sweeper Robot

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
    balance: { type: Number, default: 0.00 }, // Dabba 1: Main Safe Wallet
    totalData: { type: Number, default: 0 },
    upiId: { type: String, default: "" },
    referralCode: { type: String, unique: true }, 
    referredBy: { type: String, default: null }, 
    lastActive: { type: Date, default: Date.now },
    joinedAt: { type: Date, default: Date.now },
    
    // 🛡️ Anti-Hack: Daily Limit Trackers for Tasks
    dailyTaskEarnings: { type: Number, default: 0 },
    lastTaskDate: { type: String, default: "" },

    // 🔥 NEW: THE 9 PM JACKPOT ECONOMY
    dailyTaskMeter: { type: Number, default: 0.00 }, // Dabba 2: (₹0 to ₹20 Target)
    goldenPassUnlocked: { type: Boolean, default: false }, // Ticket Status
    isEliminatedToday: { type: Boolean, default: false } // Live Game Status
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

// ☀️ SOLAR LEAD MODEL
const solarLeadSchema = new mongoose.Schema({
    submittedBy: { type: String, required: true }, 
    customerName: { type: String, required: true },
    mobileNumber: { type: String, required: true, unique: true }, 
    city: { type: String, required: true },
    bill: { type: String, required: true },
    status: { type: String, default: "Pending" }, 
    date: { type: Date, default: Date.now }
});
const SolarLead = mongoose.model('SolarLead', solarLeadSchema);

// ❓ NEW: LIVE ARENA QUESTIONS MODEL (Zero Repeat & Multi-Language)
const liveQuestionSchema = new mongoose.Schema({
    question_en: { type: String, required: true },
    question_hi: { type: String, default: "" },
    question_mr: { type: String, default: "" },
    options_en: { type: Object, required: true }, // { A: "Ans 1", B: "Ans 2"... }
    options_hi: { type: Object, default: {} },
    options_mr: { type: Object, default: {} },
    correctAnswer: { type: String, required: true }, // "A", "B", "C" or "D"
    isUsed: { type: Boolean, default: false }, // Zero-Repeat Logic Lock
    usedDate: { type: Date, default: null }
});
const LiveQuestion = mongoose.model('LiveQuestion', liveQuestionSchema);

// ==========================================
// 🤖 THE ROBOTS (AUTOMATION)
// ==========================================

// 🕛 MIDNIGHT SWEEPER (Runs daily at 12:00 AM IST)
cron.schedule('0 0 * * *', async () => {
    console.log("🧹 MIDNIGHT SWEEPER: Resetting Daily Meters & Locking Golden Passes...");
    try {
        await User.updateMany(
            {}, 
            { 
                $set: { 
                    dailyTaskMeter: 0, 
                    goldenPassUnlocked: false,
                    isEliminatedToday: false 
                } 
            }
        );
        console.log("✅ All passes locked and meters reset for the new day!");
    } catch (e) {
        console.error("❌ Midnight Sweeper Error:", e);
    }
}, {
    timezone: "Asia/Kolkata"
});


// ==========================================
// 🔓 PUBLIC ROUTES (For Flutter App Only)
// ==========================================

app.get('/', (req, res) => {
    res.send("VELOCITA INDIAN SERVER IS ONLINE 🇮🇳 (With Mega Jackpot Engine)");
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
        
        // Mining Logic
        if (diff > 8) { 
            const earning = 0.01; 
            user.balance += earning;

            // Referral Earning
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
            upiId: user.upiId,
            // Send Daily Target Info to Flutter UI
            dailyTaskMeter: user.dailyTaskMeter,
            isPassUnlocked: user.goldenPassUnlocked
        });
    } catch (e) {
        res.status(500).json({ error: "Server Error" });
    }
});

// 🔥 B. UPDATE BALANCE API (Dual Wallet Routing)
app.post('/updateBalance', async (req, res) => {
    const { deviceId, amount, reason } = req.body;
    if (!deviceId || amount == null) return res.status(400).json({ error: "Missing data" });

    try {
        const user = await User.findOne({ deviceId });
        if (!user) return res.status(404).json({ error: "User not found" });

        const today = new Date().toISOString().substring(0, 10); 
        if (user.lastTaskDate !== today) {
            user.dailyTaskEarnings = 0;
            user.lastTaskDate = today;
        }

        const requestedAmount = parseFloat(amount);

        if (requestedAmount > 2.0) {
            console.log(`🚨 HACK ATTEMPT: ${deviceId} tried to add ₹${requestedAmount}`);
            return res.status(403).json({ error: "Suspicious activity detected!" });
        }
        if (user.dailyTaskEarnings + requestedAmount > 15.0) {
            return res.status(429).json({ error: "Daily task limit reached." });
        }

        // 💰 Dabba 1: Main Balance Hamesha Badhega
        user.balance += requestedAmount;
        user.dailyTaskEarnings += requestedAmount;

        // 🎟️ Dabba 2: Sirf Tasks/Offers se Daily Meter badhega
        if (reason.includes("Task") || reason.includes("Survey") || reason.includes("Scratch")) {
            user.dailyTaskMeter += requestedAmount;

            // 🔓 Unlock Golden Pass if target reached (₹20)
            if (user.dailyTaskMeter >= 20.0 && !user.goldenPassUnlocked) {
                user.goldenPassUnlocked = true;
                console.log(`🎟️ GOLDEN PASS UNLOCKED for ${deviceId}!`);
            }
        }

        await user.save();

        res.json({ 
            success: true, 
            newBalance: user.balance,
            dailyMeter: user.dailyTaskMeter,
            isUnlocked: user.goldenPassUnlocked 
        });
    } catch (e) {
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

        const newPayout = new Payout({ deviceId, amount: user.balance, method, details });
        await newPayout.save();

        user.upiId = details;
        user.balance = 0; 
        await user.save();

        res.json({ status: "success", message: "Request Sent!" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ☀️ SUBMIT SOLAR LEAD
app.post('/submit-solar-lead', async (req, res) => {
    const { deviceId, customerName, mobileNumber, city, bill } = req.body;
    try {
        const existingLead = await SolarLead.findOne({ mobileNumber });
        if (existingLead) return res.status(400).json({ error: "Duplicate number!" });

        const newLead = new SolarLead({ submittedBy: deviceId, customerName, mobileNumber, city, bill });
        await newLead.save();

        res.json({ success: true, message: "Lead submitted successfully!" });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// ☀️ GET MY SOLAR LEADS
app.get('/my-solar-leads', async (req, res) => {
    const { deviceId } = req.query;
    try {
        const leads = await SolarLead.find({ submittedBy: deviceId }).sort({ date: -1 });
        res.json(leads);
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// 💳 GET MY TRANSACTION HISTORY
app.get('/my-transactions', async (req, res) => {
    const { deviceId } = req.query;
    try {
        const payouts = await Payout.find({ deviceId }).sort({ date: -1 });
        res.json(payouts);
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// D. BIND REFERRAL
app.post('/bindReferral', async (req, res) => {
    const { deviceId, hardwareId, promoCode } = req.body;
    try {
        if (hardwareId && hardwareId !== "unknown_device") {
            const existingDevice = await User.findOne({ hardwareId: hardwareId, hasClaimedReferral: true });
            if (existingDevice && existingDevice.deviceId !== deviceId) {
                return res.status(400).json({ error: "Fraud detected!" });
            }
        }

        let user = await User.findOne({ deviceId });
        if (!user || user.referredBy || user.hasClaimedReferral) return res.status(400).json({ error: "Invalid/Already claimed" });

        const referrer = await User.findOne({ referralCode: promoCode });
        if (!referrer || referrer.deviceId === deviceId) return res.status(400).json({ error: "Invalid Code" });

        referrer.balance += 10.00;
        await referrer.save();

        user.referredBy = referrer.deviceId; user.hardwareId = hardwareId; user.hasClaimedReferral = true; 
        await user.save();

        res.json({ success: true, message: "Referral Applied!" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// ==========================================
// 🔐 SECURE ADMIN ROUTES (Password Protected)
// ==========================================

const adminAuth = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    const ADMIN_USER = "admin";
    const ADMIN_PASS = "velocita@2026"; 

    if (login === ADMIN_USER && password === ADMIN_PASS) {
        return next(); 
    }

    res.set('WWW-Authenticate', 'Basic realm="Velocita Command Center"');
    res.status(401).send('🛑 ACCESS DENIED! You are not the Admin.');
};

app.get(['/panel', '/admin', '/dashboard'], adminAuth, (req, res) => {
    const publicPath = path.join(__dirname, 'public', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');

    if (fs.existsSync(publicPath)) { res.sendFile(publicPath); } 
    else if (fs.existsSync(rootPath)) { res.sendFile(rootPath); } 
    else { res.status(404).send(`<h1 style="color: red; text-align: center; margin-top: 50px;">🚨 Error 404: HTML File Missing!</h1>`); }
});

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

// ☀️ ADMIN SOLAR LEADS MANAGEMENT
app.get('/admin/solar-leads', adminAuth, async (req, res) => {
    try {
        const leads = await SolarLead.find().sort({ date: -1 });
        res.json(leads);
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// 💰 ADMIN UPDATE LEAD STATUS & AUTO-PAY ₹1500
app.post('/admin/update-solar-lead', adminAuth, async (req, res) => {
    const { leadId, newStatus } = req.body;
    try {
        const lead = await SolarLead.findById(leadId);
        if (!lead) return res.status(404).json({ error: "Lead not found" });

        if (lead.status === "Paid") return res.status(400).json({ error: "Lead is already Paid." });

        lead.status = newStatus;
        await lead.save();

        // 🎉 Auto-Pay ₹1500 directly into Main Wallet
        if (newStatus === "Paid") {
            const user = await User.findOne({ deviceId: lead.submittedBy });
            if (user) {
                user.balance += 1500.00;
                await user.save();
                console.log(`🔥 SOLAR SUCCESS: ₹1500 added to ${user.deviceId}`);
            }
        }
        res.json({ success: true, message: `Status updated to ${newStatus}` });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// ❓ NEW: ADMIN API TO ADD QUESTION TO THE VAULT
app.post('/admin/add-question', adminAuth, async (req, res) => {
    const { question_en, options_en, correctAnswer } = req.body;
    try {
        const newQuestion = new LiveQuestion({ question_en, options_en, correctAnswer });
        await newQuestion.save();
        console.log("🔮 NEW QUESTION ADDED TO VAULT!");
        res.json({ success: true });
    } catch (e) {
        console.error("Error adding question:", e);
        res.status(500).json({ error: "Server Error" });
    }
});

// SERVER START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Indian Server running on Port ${PORT}`);
});
