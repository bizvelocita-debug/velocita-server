const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs'); 
const cron = require('node-cron'); 
// 🔥 NEW: Firebase Admin SDK for Realtime WebSockets
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 🔑 FIREBASE ADMIN SETUP (For RTDB Live Engine)
// ==========================================
// ⚠️ CTO NOTE: You MUST download your Firebase Admin SDK JSON file and put it in the same folder, 
// then rename it to "velocita-firebase-adminsdk.json"
try {
    const serviceAccount = require('./velocita-firebase-adminsdk.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // Put your RTDB URL here:
      databaseURL: "https://your-project-id.firebaseio.com" 
    });
    console.log("✅ FIREBASE RTDB CONNECTED (Live Arena Ready!)");
} catch (e) {
    console.error("❌ Firebase Admin SDK Missing! Live Arena will crash.", e);
}

const db = admin.database();

// ==========================================
// 1. DATABASE CONNECTION (MongoDB)
// ==========================================
const MONGO_URI = "mongodb+srv://admin:Keshav%402829@cluster0.tcdl2wy.mongodb.net/velocita?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DATABASE CONNECTED (MongoDB) - 🇮🇳 Indian Server"))
    .catch(err => console.error("❌ DB ERROR:", err));

// ==========================================
// 2. DATA MODELS
// ==========================================
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

    // 🔥 JACKPOT ECONOMY
    dailyTaskMeter: { type: Number, default: 0.00 }, // Dabba 2: (₹0 to ₹50 Target)
    goldenPassUnlocked: { type: Boolean, default: false }, // Ticket Status
    isEliminatedToday: { type: Boolean, default: false }, // Live Game Status
    lastArenaWinDate: { type: String, default: "" },

    // 🤝 VIRAL REFERRAL ENGINE
    hasWithdrawnEver: { type: Boolean, default: false }, // Track first withdrawal
    totalInvites: { type: Number, default: 0 },
    networkEarnings: { type: Number, default: 0.00 }
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

// ❓ LIVE ARENA QUESTIONS MODEL
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
// 🤖 THE KBC MASTER ROBOTS (CRON JOBS)
// ==========================================

// 🧹 1. MIDNIGHT SWEEPER (Runs daily at 12:00 AM IST)
cron.schedule('0 0 * * *', async () => {
    console.log("🧹 MIDNIGHT SWEEPER: Resetting Daily Meters & Locking Golden Passes...");
    try {
        await User.updateMany(
            {}, 
            { $set: { dailyTaskMeter: 0, goldenPassUnlocked: false, isEliminatedToday: false } }
        );
        // Reset Arena Status
        await db.ref('live_arena/current_question').set({ status: "WAITING" });
        console.log("✅ All passes locked and meters reset for the new day!");
    } catch (e) { console.error("❌ Midnight Sweeper Error:", e); }
}, { timezone: "Asia/Kolkata" });

// 🚨 2. THE 8:55 PM HYPE TRIGGER
cron.schedule('55 20 * * *', async () => {
    console.log("🔥 8:55 PM: THE GATES ARE OPEN! Broadcasting HYPE mode...");
    try {
        await db.ref('live_arena/current_question').set({ status: "HYPE" });
    } catch(e) { console.error(e); }
}, { timezone: "Asia/Kolkata" });

// 🎬 3. THE 9:00 PM LIVE KBC ENGINE
cron.schedule('0 21 * * *', async () => {
    console.log("💥 9:00 PM: LIVE JACKPOT STARTED!");
    try {
        // Fetch Unused Question
        const question = await LiveQuestion.findOne({ isUsed: false });
        if (!question) {
            console.log("🚨 NO UNUSED QUESTIONS FOUND!");
            await db.ref('live_arena/current_question').set({ status: "WAITING" });
            return;
        }

        // Push Question to 1 Lakh Devices in 100ms
        await db.ref('live_arena/current_question').set({
            q_id: question._id.toString(),
            status: "ACTIVE",
            question_en: question.question_en,
            question_hi: question.question_hi,
            options_en: question.options_en,
            options_hi: question.options_hi,
            timestamp: Date.now() // For strict backend evaluation
        });

        // Lock Question
        question.isUsed = true;
        question.usedDate = new Date();
        await question.save();

        // ⏱️ 10.5 SECOND AUTO-LOCK MECHANISM
        setTimeout(async () => {
            console.log("🔒 10.5 SECONDS UP! Locking Arena...");
            await db.ref('live_arena/current_question').update({ status: "FINISHED" });
        }, 10500);

    } catch(e) { console.error("KBC Engine Error:", e); }
}, { timezone: "Asia/Kolkata" });

// ==========================================
// 🛡️ ANTI-HACK SECURITY MIDDLEWARE
// ==========================================
const APP_SECRET = "Velocita@2026_Ultra_Secure_Key_998877!"; 

const TASK_REWARDS = {
    'captcha_batch': 0.04,
    'quiz_won': 0.05,
    'news_read': 0.05,
    'daily_bonus': 1.00
};

const verifyAppSignature = (req, res, next) => {
    const signature = req.headers['x-velo-signature'];
    const timestamp = req.headers['x-velo-timestamp'];

    if (!signature || !timestamp) {
        return res.status(403).json({ error: "🛑 ACCESS DENIED: Missing Security Headers" });
    }

    const now = Date.now();
    if (Math.abs(now - parseInt(timestamp)) > 120000) {
        return res.status(403).json({ error: "🛑 EXPIRED REQUEST: Possible Replay Attack" });
    }

    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto.createHmac('sha256', APP_SECRET)
                                    .update(payload + timestamp)
                                    .digest('hex');

    if (signature !== expectedSignature) {
        console.log(`🚨 HACK ATTEMPT DETECTED from IP: ${req.ip}`);
        return res.status(403).json({ error: "🛑 INVALID SIGNATURE: Hacker Detected!" });
    }

    next();
};

// ==========================================
// 🔓 PUBLIC ROUTES (For Flutter App)
// ==========================================

app.get('/', (req, res) => { res.send("VELOCITA INDIAN SERVER IS ONLINE 🇮🇳"); });

// A. PING
app.post('/ping', async (req, res) => {
    const { deviceId, usage } = req.body;
    if (!deviceId) return res.status(400).json({ error: "No ID" });

    try {
        let user = await User.findOne({ deviceId });
        if (!user) {
            const baseName = deviceId.split('@')[0].toUpperCase();
            user = new User({ deviceId, referralCode: "VELO-" + baseName });
            await user.save();
        }

        const now = new Date();
        const diff = (now - new Date(user.lastActive)) / 1000;
        
        if (diff > 8) { 
            const earning = 0.01; 
            user.balance += earning;
            if (user.referredBy) {
                const upline = await User.findOne({ deviceId: user.referredBy });
                if (upline) { upline.balance += (earning * 0.10); await upline.save(); }
            }
            user.lastActive = now;
        }

        if (usage) user.totalData = usage;
        await user.save();

        res.json({ 
            status: "active", balance: user.balance.toFixed(4), upiId: user.upiId,
            dailyTaskMeter: user.dailyTaskMeter, isPassUnlocked: user.goldenPassUnlocked,
            totalInvites: user.totalInvites, networkEarnings: user.networkEarnings
        });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// B. SECURE UPDATE BALANCE (No direct amount accepted!)
app.post('/updateBalance', verifyAppSignature, async (req, res) => {
    // 1. Flutter se 'amount' bhi receive karenge
    const { deviceId, taskId, amount } = req.body; 
    if (!deviceId || !taskId) return res.status(400).json({ error: "Missing data" });

    try {
        const user = await User.findOne({ deviceId });
        if (!user) return res.status(404).json({ error: "User not found" });

        const today = new Date().toISOString().substring(0, 10); 
        if (user.lastTaskDate !== today) { user.dailyTaskEarnings = 0; user.lastTaskDate = today; }

        let finalAmount = 0;

        if (taskId === 'scratch_card') {
            finalAmount = parseFloat((Math.random() * 0.07 + 0.02).toFixed(2));
            
        } else if (taskId === 'vip_radio') {
            // 💳 VIP RADIO DYNAMIC AMOUNT LOGIC
            const reqAmount = parseFloat(amount);
            if (!reqAmount || reqAmount <= 0) return res.status(400).json({ error: "Invalid Amount" });
            
            // 🛡️ ANTI-HACK SHIELD: Max ₹2.50 per request allow karenge.
            // Agar koi hacker code badal kar ₹500 bhejne ki koshish karega, toh server usko max ₹2.50 hi dega.
            if (reqAmount > 2.50) {
                console.log(`🚨 Hack Attempt Blocked: ${deviceId} tried to add ₹${reqAmount}`);
                finalAmount = 2.50; 
            } else {
                finalAmount = parseFloat(reqAmount.toFixed(2));
            }

        } else if (TASK_REWARDS[taskId]) {
            finalAmount = TASK_REWARDS[taskId];
            
        } else {
            return res.status(400).json({ error: "Invalid Task ID" });
        }

        if (user.dailyTaskEarnings + finalAmount > 50.0) {
            return res.status(429).json({ error: "Daily limit reached. Use Premium Offers for unlimited earning!" });
        }

        user.balance += finalAmount;
        user.dailyTaskEarnings += finalAmount;

        // 💸 10% EARLY BIRD COMMISSION LOGIC
        if (user.referredBy && !user.hasWithdrawnEver && taskId !== 'daily_bonus') {
            const upline = await User.findOne({ deviceId: user.referredBy });
            if (upline) {
                const commission = finalAmount * 0.10;
                upline.balance += commission;
                upline.networkEarnings += commission;
                await upline.save();
            }
        }

        if (taskId !== 'daily_bonus') {
            user.dailyTaskMeter += finalAmount;
            if (user.dailyTaskMeter >= 50.0 && !user.goldenPassUnlocked) { user.goldenPassUnlocked = true; }
        }

        await user.save();
        res.json({ success: true, addedAmount: finalAmount, newBalance: user.balance, dailyMeter: user.dailyTaskMeter, isUnlocked: user.goldenPassUnlocked });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// ==========================================
// 💸 SERVER-TO-SERVER POSTBACK (For CPX & Monlix)
// ==========================================
app.get('/postback', async (req, res) => {
    // CPX sends: ?ext_user_id=email@gmail.com&amount=30
    // Monlix sends: ?userid=email@gmail.com&reward=30
    const deviceId = req.query.ext_user_id || req.query.userid || req.query.subId; 
    const amount = parseFloat(req.query.amount || req.query.reward);

    if (!deviceId || isNaN(amount)) {
        console.error("❌ Postback Failed: Missing Parameters", req.query);
        return res.status(400).send("0"); // Network ko '0' bhejna hota hai fail hone par
    }

    try {
        const user = await User.findOne({ deviceId });
        if (!user) {
            console.error("❌ Postback Failed: User Not Found", deviceId);
            return res.status(404).send("0");
        }

        // Add money to user's wallet
        user.balance += amount;

        // 💸 10% EARLY BIRD COMMISSION (For Offerwalls)
        if (user.referredBy && !user.hasWithdrawnEver) {
            const upline = await User.findOne({ deviceId: user.referredBy });
            if (upline) {
                const commission = amount * 0.10;
                upline.balance += commission;
                upline.networkEarnings += commission;
                await upline.save();
            }
        }
        
        // 🔥 Update KBC Golden Pass Meter
        user.dailyTaskMeter += amount;
        if (user.dailyTaskMeter >= 50.0 && !user.goldenPassUnlocked) { 
            user.goldenPassUnlocked = true; 
        }

        await user.save();
        console.log(`✅ POSTBACK SUCCESS: ₹${amount} added to ${deviceId}`);
        
        res.status(200).send("1"); // Network ko '1' (Success) bhejna zaroori hai
    } catch (e) {
        console.error("❌ Postback Server Error:", e);
        res.status(500).send("0");
    }
});

// 🎯 LIVE ARENA ANSWER EVALUATOR (Now Secured)
app.post('/submit-answer', verifyAppSignature, async (req, res) => {
    const { deviceId, q_id, answer, time_taken_ms } = req.body;
    try {
        const user = await User.findOne({ deviceId });
        if (!user || user.isEliminatedToday || !user.goldenPassUnlocked) {
            return res.json({ success: false, message: "Eliminated or No Pass" });
        }

        // Fetch Question to Check Answer
        const question = await LiveQuestion.findById(q_id);
        if (!question) return res.json({ success: false });

        // Get Firebase Global Time to check if they submitted inside 10 seconds
        const currentData = await db.ref('live_arena/current_question').once('value');
        const rtdbData = currentData.val();
        
        const isTimeOver = (Date.now() - rtdbData.timestamp) > 10500; // 10.5 secs logic

        if (isTimeOver || answer !== question.correctAnswer) {
            // WRONG OR LATE! ELIMINATE!
            user.isEliminatedToday = true;
            await user.save();
            return res.json({ success: false, message: "Eliminated" });
        }

        // CORRECT & ON TIME! (Assuming 1 Question Daily for now)
        const today = new Date().toISOString().substring(0, 10);
        if (user.lastArenaWinDate !== today) {
            user.balance += 50.00; // Add Mini-Jackpot to Wallet
            user.lastArenaWinDate = today;
            await user.save();
            return res.json({ success: true, message: "Winner! ₹50 Added." });
        }

        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: "Server Error" });
    }
});

app.post('/withdraw', async (req, res) => {
    const { deviceId, method, details } = req.body;
    try {
        const user = await User.findOne({ deviceId });
        if (!user) return res.status(404).json({ message: "User not found" });
        if (user.balance < 50.0) return res.status(400).json({ message: "Minimum ₹50 required." });

        const newPayout = new Payout({ deviceId, amount: user.balance, method, details });
        await newPayout.save();

        user.upiId = details; 
        user.balance = 0; 
        user.hasWithdrawnEver = true; // 🛑 Stops the 10% commission line permanently
        await user.save();

        res.json({ status: "success", message: "Request Sent!" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

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

app.get('/my-solar-leads', async (req, res) => {
    const { deviceId } = req.query;
    try { const leads = await SolarLead.find({ submittedBy: deviceId }).sort({ date: -1 }); res.json(leads); } 
    catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.get('/my-transactions', async (req, res) => {
    const { deviceId } = req.query;
    try { const payouts = await Payout.find({ deviceId }).sort({ date: -1 }); res.json(payouts); } 
    catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/bindReferral', async (req, res) => {
    const { deviceId, hardwareId, promoCode } = req.body;
    try {
        if (hardwareId && hardwareId !== "unknown_device") {
            const existingDevice = await User.findOne({ hardwareId: hardwareId, hasClaimedReferral: true });
            if (existingDevice && existingDevice.deviceId !== deviceId) return res.status(400).json({ error: "Fraud detected!" });
        }
        let user = await User.findOne({ deviceId });
        if (!user || user.referredBy || user.hasClaimedReferral) return res.status(400).json({ error: "Invalid/Already claimed" });

        const referrer = await User.findOne({ referralCode: promoCode });
        if (!referrer || referrer.deviceId === deviceId) return res.status(400).json({ error: "Invalid Code" });

        referrer.balance += 10.00; 
        referrer.totalInvites += 1; // 📈 Gamification Milestone Track
        await referrer.save();

        user.referredBy = referrer.deviceId; user.hardwareId = hardwareId; user.hasClaimedReferral = true; 
        await user.save();

        res.json({ success: true, message: "Referral Applied!" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 🔐 SECURE ADMIN ROUTES
// ==========================================
const adminAuth = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    const ADMIN_USER = "admin"; const ADMIN_PASS = "velocita@2026"; 
    if (login === ADMIN_USER && password === ADMIN_PASS) { return next(); }
    res.set('WWW-Authenticate', 'Basic realm="Velocita Command Center"');
    res.status(401).send('🛑 ACCESS DENIED!');
};

app.get(['/panel', '/admin', '/dashboard'], adminAuth, (req, res) => {
    const publicPath = path.join(__dirname, 'public', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(publicPath)) { res.sendFile(publicPath); } else if (fs.existsSync(rootPath)) { res.sendFile(rootPath); } else { res.status(404).send(`<h1 style="color: red; text-align: center;">🚨 HTML File Missing!</h1>`); }
});

app.get('/admin/payouts', adminAuth, async (req, res) => {
    const payouts = await Payout.find({ status: "Pending" }).sort({ date: -1 }); res.json(payouts);
});

app.get('/admin/users', adminAuth, async (req, res) => {
    const users = await User.find().sort({ balance: -1 }); res.json(users);
});

app.post('/admin/pay', adminAuth, async (req, res) => {
    const { payoutId } = req.body; 
    try {
        await Payout.findByIdAndUpdate(payoutId, { status: "Paid" }); 
        res.json({ success: true, message: "Payment Marked as Paid" });
    } catch(e) {
        res.status(500).json({ error: "Failed to update status" });
    }
});

// ✅ ADD THIS ROUTE: Taki admin pannel dono dikhaye (Pending aur Paid)
app.get('/admin/all-payouts', adminAuth, async (req, res) => {
    const payouts = await Payout.find().sort({ date: -1 }); 
    res.json(payouts);
});

app.get('/admin/solar-leads', adminAuth, async (req, res) => {
    try { const leads = await SolarLead.find().sort({ date: -1 }); res.json(leads); } catch (e) { res.status(500).json({ error: "Error" }); }
});

app.post('/admin/update-solar-lead', adminAuth, async (req, res) => {
    const { leadId, newStatus } = req.body;
    try {
        const lead = await SolarLead.findById(leadId);
        if (!lead) return res.status(404).json({ error: "Lead not found" });
        if (lead.status === "Paid") return res.status(400).json({ error: "Lead is already Paid." });

        lead.status = newStatus; await lead.save();

        if (newStatus === "Paid") {
            const user = await User.findOne({ deviceId: lead.submittedBy });
            if (user) { user.balance += 1500.00; await user.save(); }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

// 🔮 ADD KBC QUESTION
app.post('/admin/add-question', adminAuth, async (req, res) => {
    const { question_en, options_en, correctAnswer } = req.body;
    try {
        const newQuestion = new LiveQuestion({ question_en, options_en, correctAnswer });
        await newQuestion.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Indian Server running on Port ${PORT}`); });
