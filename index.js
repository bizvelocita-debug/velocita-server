require('dotenv').config(); // 👈 YEH LINE SABSE UPAR AAYEGI
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
// 🛡️ NAYA: Raw JSON body ko save karna taaki Security Signature match ho sake
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

// ==========================================
// 🔑 FIREBASE ADMIN SETUP (For RTDB Live Engine)
// ==========================================
// ⚠️ CTO NOTE: You MUST download your Firebase Admin SDK JSON file and put it in the same folder, 
// then rename it to "velocita-firebase-adminsdk.json"
try {
    // 🔥 NAYA CODE: Ab hum file se nahi, Render ki tijori se chaabi nikalenge!
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://velocita-app.firebaseio.com" // Apne Firebase ka real URL check kar lena ek baar
    });
    console.log("✅ FIREBASE RTDB CONNECTED (Live Arena Ready!)");
} catch (e) {
    console.error("❌ Firebase SDK Setup Error! Check Environment Variables.", e);
}

const db = admin.database();

// ==========================================
// 1. DATABASE CONNECTION (MongoDB)
// ==========================================
const MONGO_URI = process.env.MONGO_URI; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DATABASE CONNECTED (MongoDB) - 🇮🇳 Indian Server"))
    .catch(err => console.error("❌ DB ERROR:", err));

// ==========================================
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
    lastTaskTime: { type: Date, default: null }, // ⏳ Rate Limiting (Auto-clicker blocker)
    lastBonusDate: { type: String, default: "" }, // 🎁 Daily Bonus Hack Blocker
    scratchCountToday: { type: Number, default: 0 }, // 🔥 NAYA: Scratch limit counter
    fcmToken: { type: String, default: "" },     // 🔔 Push Notification Token

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
// 🛡️ ANTI-HACK: Device Blacklist for Referrals
const usedDeviceSchema = new mongoose.Schema({
    hardwareId: { type: String, unique: true }
});
const UsedDevice = mongoose.model('UsedDevice', usedDeviceSchema);


// ==========================================
// 🤖 THE KBC MASTER ROBOTS (CRON JOBS)
// ==========================================

// 🧹 1. MIDNIGHT SWEEPER (Server-Safe Batch Processing)
cron.schedule('0 0 * * *', async () => {
    console.log("🧹 MIDNIGHT SWEEPER: Resetting Safely...");
    try {
        await db.ref('live_arena/current_question').set({ status: "WAITING" });

        // Cursor use kiya taaki RAM over-load na ho
        const cursor = User.find({ 
            $or: [{ dailyTaskMeter: { $gt: 0 } }, { goldenPassUnlocked: true }, { isEliminatedToday: true }] 
        }).cursor();

        let bulkOps = [];
        for await (const doc of cursor) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: { $set: { dailyTaskMeter: 0, goldenPassUnlocked: false, isEliminatedToday: false } }
                }
            });

            if (bulkOps.length === 1000) { // 1000 users ek baar mein
                await User.bulkWrite(bulkOps);
                bulkOps = [];
            }
        }
        if (bulkOps.length > 0) await User.bulkWrite(bulkOps); // Bache hue users
        console.log("✅ All passes locked and meters reset without crashing Server!");
    } catch (e) { console.error("❌ Midnight Sweeper Error:", e); }
}, { timezone: "Asia/Kolkata" });

// 🚨 2. THE 8:55 PM HYPE TRIGGER
cron.schedule('55 20 * * *', async () => {
    console.log("🔥 8:55 PM: THE GATES ARE OPEN! Broadcasting HYPE mode...");
    try { await db.ref('live_arena/current_question').set({ status: "HYPE" }); } catch(e) { }
}, { timezone: "Asia/Kolkata" });

// 🔔 4. THE 8:50 PM ALARM (Memory-Safe Notification Sender)
cron.schedule('50 20 * * *', async () => {
    console.log("🔔 8:50 PM: Sending FCM Notification in batches...");
    try {
        // Cursor memory leak nahi hone dega
        const cursor = User.find({ fcmToken: { $ne: "", $exists: true } }).select('fcmToken').cursor();
        
        let tokens = [];
        for await (const doc of cursor) {
            tokens.push(doc.fcmToken);
            
            if (tokens.length === 500) { // Firebase ki max limit 500 hai
                await admin.messaging().sendEachForMulticast({
                    notification: { title: "🔥 KBC Arena starts in 5 mins!", body: "Hurry up! Win ₹50,000 Cash! Open the app now! 💸" },
                    tokens: tokens
                }).catch(e => console.log("Batch push failed, ignoring..."));
                tokens = [];
            }
        }
        if (tokens.length > 0) { // Bache hue 500 se kam logo ko bhejo
            await admin.messaging().sendEachForMulticast({
                notification: { title: "🔥 KBC Arena starts in 5 mins!", body: "Hurry up! Win ₹50,000 Cash! Open the app now! 💸" },
                tokens: tokens
            }).catch(e => {});
        }
        console.log(`✅ Safely sent all notifications!`);
    } catch(e) { console.error("❌ FCM Error:", e); }
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
// 🛡️ ADVANCED ANTI-HACK SECURITY MIDDLEWARE
// ==========================================
const APP_SECRET = process.env.APP_SECRET; 

const TASK_REWARDS = {
    'captcha_batch': 0.04,
    'quiz_won': 0.05,
    'news_read': 0.05,
    'daily_bonus': 1.00,
    'vip_radio_ping': 0.02  // 🚨 NAYA: RAM HACK KILLER! Ab amount server tay karega
};

// 🛡️ FIX 1: ADVANCED NONCE CACHE (Replay Attack Killer)
const usedNonces = new Map();
const NONCE_TTL = 60 * 1000; // 60 seconds expiry
// Ye loop sirf EXPIRE hue nonces ko delete karega, poori memory saaf nahi karega
setInterval(() => {
    const now = Date.now();
    for (let [nonce, timestamp] of usedNonces.entries()) {
        if (now - timestamp > NONCE_TTL) usedNonces.delete(nonce);
    }
}, 10 * 1000); // Har 10 second mein check karega
const verifyAppSignature = async (req, res, next) => {
    const signature = req.headers['x-velo-signature'];
    const timestamp = req.headers['x-velo-timestamp'];
    const nonce = req.headers['x-velo-nonce'];
    const authHeader = req.headers['authorization']; 

    if (!signature || !timestamp || !nonce || !authHeader) {
        return res.status(403).json({ error: "🛑 ACCESS DENIED: Missing Security Headers" });
    }

    // 1. FIREBASE AUTH CHECK (Botnet Killer - CRASH FIXED)
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(403).json({ error: "🛑 INVALID AUTH FORMAT" });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.userEmail = decodedToken.email; // Asli email Firebase se nikala!
    } catch (err) {
        console.log(`🚨 FAKE GOOGLE LOGIN ATTEMPT: ${req.ip}`);
        return res.status(403).json({ error: "🛑 FAKE ACCOUNT BLOCKED!" });
    }

    // 2. REPLAY ATTACK CHECK (Time Machine Killer - 60s Strict Window)
    const now = Date.now();
    if (Math.abs(now - parseInt(timestamp)) > 60000) { // 👈 120s se 60s kar diya
        return res.status(403).json({ error: "🛑 EXPIRED REQUEST" });
    }
    if (usedNonces.has(nonce)) {
        console.log(`🚨 REPLAY ATTACK BLOCKED from ${req.userEmail}`);
        return res.status(403).json({ error: "🛑 REQUEST ALREADY USED!" });
    }
    usedNonces.set(nonce, now); // 👈 Map mein time ke sath save kiya

    // 3. HMAC SIGNATURE CHECK (Tamper Proofing)
    const payload = req.rawBody || ""; // 🎯 FIXED: Ab exact wahi data check hoga jo app ne bheja tha
    const expectedSignature = crypto.createHmac('sha256', APP_SECRET)
                                    .update(payload + timestamp + nonce) // Nonce hash mein add kiya
                                    .digest('hex');

    if (signature !== expectedSignature) {
        return res.status(403).json({ error: "🛑 INVALID SIGNATURE" });
    }

    // 4. IDENTITY MISMATCH CHECK (Hacker dusre ka email use nahi kar sakta)
    if (req.body.deviceId && req.body.deviceId !== req.userEmail) {
        return res.status(403).json({ error: "🛑 IDENTITY THEFT BLOCKED!" });
    }

    next();
};

// ==========================================
// 🔓 PUBLIC ROUTES (For Flutter App)
// ==========================================

app.get('/', (req, res) => { res.send("VELOCITA INDIAN SERVER IS ONLINE 🇮🇳"); });

// A. PING (Now Secured!)
app.post('/ping', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; // 🛡️ Firebase Token Email
    const { usage } = req.body;
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
            // 💸 70/30 SPLIT LOGIC
            // Pawns rate: ₹16.60/GB. User's 30% share = ₹4.98/GB.
            // 1 MB = ₹0.005 (User Share). Har ping par itna hi denge!
            const earning = 0.005; 
            
            // 🚨 PING MEIN BHI LIMIT LAGA DI! (Unlimited Glitch Fixed) (Unlimited Glitch Fixed)
            if (user.dailyTaskEarnings + earning <= 50.0) {
                user.balance += earning;
                user.dailyTaskEarnings += earning;
                if (user.referredBy && !user.hasWithdrawnEver) {
                    const upline = await User.findOne({ deviceId: user.referredBy });
                    if (upline) { upline.balance += (earning * 0.10); await upline.save(); }
                }
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

// B. SECURE UPDATE BALANCE (With Auto-Clicker & Bonus Protection)
app.post('/updateBalance', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail;
    const { taskId, dynamicAmount } = req.body; 
    if (!deviceId || !taskId) return res.status(400).json({ error: "Missing data" });

    try {
        const user = await User.findOne({ deviceId });
        if (!user) return res.status(404).json({ error: "User not found" });

        const now = new Date();
        const today = now.toISOString().substring(0, 10); 

        // 🔥 Daily Reset Logic (Naya din shuru hone par sab clear karo)
        if (user.lastTaskDate !== today) { 
            user.dailyTaskEarnings = 0; 
            user.lastTaskDate = today; 
            user.scratchCountToday = 0; // Agle din scratch wapas 0 kar do
        }

        // 🛑 1. DAILY BONUS HACK BLOCKER
        if (taskId === 'daily_bonus') {
            if (user.lastBonusDate === today) {
                console.log(`🚨 BONUS HACK ATTEMPT by ${deviceId}`);
                return res.status(429).json({ error: "🚫 Hack Attempt! Bonus already claimed today." });
            }
            user.lastBonusDate = today; 
        }

        // 🛑 2. SCRATCH CARD HACK BLOCKER (Sirf 5 per day)
        if (taskId === 'scratch_card') {
            if (user.scratchCountToday >= 5) {
                console.log(`🚨 SCRATCH HACK ATTEMPT by ${deviceId}`);
                return res.status(429).json({ error: "🚫 Daily Scratch Limit Reached!" });
            }
            user.scratchCountToday += 1; // Ginti badha di
        }

        // 🛑 3. RATE LIMITING (Auto-Clicker & Radio Speed Hack Blocker)
        if (user.lastTaskTime) {
            const timeDiff = (now - user.lastTaskTime) / 1000; 
            
            if (taskId === 'vip_radio_ping') {
                if (timeDiff < 55) return res.status(429).json({ error: "⏳ Radio Speed Hack Detected!" });
            } else if (taskId !== 'daily_bonus' && taskId !== 'scratch_card') {
                if (timeDiff < 5) return res.status(429).json({ error: "⏳ Too fast! System cooling down." }); 
            }
        }

        // 💰 REWARD ASSIGNMENT
        let finalAmount = 0;
        if (taskId === 'scratch_card') {
            finalAmount = parseFloat((Math.random() * 0.07 + 0.02).toFixed(2));
        } else if (TASK_REWARDS[taskId]) {
            finalAmount = TASK_REWARDS[taskId]; 
        } else {
            return res.status(400).json({ error: "Invalid Task ID" });
        }

        // 🛑 MAX DAILY LIMIT CHECK (Taaki app bankrupt na ho)
        if (user.dailyTaskEarnings + finalAmount > 50.0) {
            return res.status(429).json({ error: "Daily limit reached. Use Premium Offers for unlimited earning!" });
        }

        // 🧮 BALANCE UPDATE
        user.balance = parseFloat((user.balance + finalAmount).toFixed(4));
        user.dailyTaskEarnings = parseFloat((user.dailyTaskEarnings + finalAmount).toFixed(4));
        user.lastTaskTime = now; 

        // 💸 10% EARLY BIRD COMMISSION
        if (user.referredBy && !user.hasWithdrawnEver && taskId !== 'daily_bonus') {
            const upline = await User.findOne({ deviceId: user.referredBy });
            if (upline) {
                const commission = finalAmount * 0.10;
                upline.balance += commission;
                upline.networkEarnings += commission;
                await upline.save();
            }
        }

        // 🎫 GOLD PASS METER UPDATE
        if (taskId !== 'daily_bonus') {
            user.dailyTaskMeter += finalAmount;
            if (user.dailyTaskMeter >= 50.0 && !user.goldenPassUnlocked) { user.goldenPassUnlocked = true; }
        }

        await user.save();
        res.json({ success: true, addedAmount: finalAmount, newBalance: user.balance, dailyMeter: user.dailyTaskMeter, isUnlocked: user.goldenPassUnlocked });
    } catch (e) { 
        console.error("Update Balance Error:", e);
        res.status(500).json({ error: "Server Error" }); 
    }
});

// 🔔 ROUTE: Naye user ka Notification Token Save karne ke liye
app.post('/update-fcm', verifyAppSignature, async (req, res) => {
    try {
        await User.findOneAndUpdate(
            { deviceId: req.userEmail }, 
            { fcmToken: req.body.fcmToken }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "FCM Update Error" }); }
});

// ==========================================
// 💸 SERVER-TO-SERVER POSTBACK (For CPX & Monlix)
// ==========================================
app.get('/postback', async (req, res) => {
    // 🛡️ ANTI-HACK: Verify the secret key from the offerwall
    const secret = req.query.secret || req.query.hash;
    if (secret !== process.env.OFFERWALL_SECRET) {
        console.error("🚨 FAKE POSTBACK BLOCKED! Invalid Secret.");
        return res.status(403).send("0");
    }

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

// 🎯 LIVE ARENA ANSWER EVALUATOR (Now Buffer Secured)
app.post('/submit-answer', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail;
    const { q_id, answer } = req.body; // time_taken_ms yahan use nahi hota, backend time use hota hai
    try {
        const user = await User.findOne({ deviceId });
        if (!user || user.isEliminatedToday || !user.goldenPassUnlocked) {
            return res.json({ success: false, message: "Eliminated or No Pass" });
        }

        const question = await LiveQuestion.findById(q_id);
        if (!question) return res.json({ success: false });

        const currentData = await db.ref('live_arena/current_question').once('value');
        const rtdbData = currentData.val();
        
        // 🛡️ NAYA: 13 Second ka Buffer diya hai (Network Ping Latency bachaane ke liye)
        const isTimeOver = (Date.now() - rtdbData.timestamp) > 13000; 

        if (isTimeOver || answer !== question.correctAnswer) {
            user.isEliminatedToday = true;
            await user.save();
            return res.json({ success: false, message: "Eliminated" });
        }

        const today = new Date().toISOString().substring(0, 10);
        if (user.lastArenaWinDate !== today) {
            user.balance += 50.00; 
            user.lastArenaWinDate = today;
            await user.save();
            return res.json({ success: true, message: "Winner! ₹50 Added." });
        }

        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: "Server Error" });
    }
});

// 💸 BULLETPROOF WITHDRAW ROUTE (Double-Tap Hack Preventer)
app.post('/withdraw', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail;
    const { method, details, amount } = req.body; 
    try {
        const requestedAmount = Math.abs(parseFloat(amount)); 
        if (isNaN(requestedAmount) || requestedAmount < 50.0) {
            return res.status(400).json({ message: "Minimum ₹50 required." });
        }

        // 🔥 FIX: Atomic Update (MongoDB pehle paise kaatega, fir aage badhega. Double-tap fail ho jayega!)
        const user = await User.findOneAndUpdate(
            { deviceId: deviceId, balance: { $gte: requestedAmount } }, // Check: Balance sufficient hai ya nahi
            { $inc: { balance: -requestedAmount }, $set: { hasWithdrawnEver: true, upiId: details } }, // Deduct balance
            { new: true }
        );

        if (!user) {
            return res.status(400).json({ message: "Insufficient balance or invalid request!" });
        }

        // Ab database mein Payout ki entry daalo
        const newPayout = new Payout({ deviceId, amount: requestedAmount, method, details });
        await newPayout.save();

        res.json({ status: "success", message: "Request Sent to Admin!" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/submit-solar-lead', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; // 🛡️ Firebase Token Email
    const { customerName, mobileNumber, city, bill } = req.body;
    try {
        const existingLead = await SolarLead.findOne({ mobileNumber });
        if (existingLead) return res.status(400).json({ error: "Duplicate number!" });

        const newLead = new SolarLead({ submittedBy: deviceId, customerName, mobileNumber, city, bill });
        await newLead.save();

        res.json({ success: true, message: "Lead submitted successfully!" });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// GET se POST kiya, aur req.query se req.body kiya!
app.post('/my-solar-leads', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; // 🛡️ Firebase Token Email 
    try { const leads = await SolarLead.find({ submittedBy: deviceId }).sort({ date: -1 }); res.json(leads); } 
    catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/my-transactions', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; // 🛡️ Firebase Token Email 
    try { const payouts = await Payout.find({ deviceId }).sort({ date: -1 }); res.json(payouts); } 
    catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/bindReferral', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; 
    const { hardwareId, promoCode } = req.body;
    try {
        // 🛡️ 1. HARDWARE ID BLACKLIST CHECK (The Ultimate Fix)
        if (hardwareId && hardwareId !== "unknown_device") {
            const isBlacklisted = await UsedDevice.findOne({ hardwareId: hardwareId });
            if (isBlacklisted) {
                console.log(`🚨 FRAUD BLOCKED: ${deviceId} tried double referral claim!`);
                return res.status(400).json({ error: "Device already used for a VIP Bonus! No double claims." });
            }
        }
        
        let user = await User.findOne({ deviceId });
        
        if (!user) {
            const baseName = deviceId.split('@')[0].toUpperCase();
            user = new User({ deviceId: deviceId, referralCode: "VELO-" + baseName, hardwareId: hardwareId });
            await user.save();
        } else if (user.referredBy || user.hasClaimedReferral) {
            return res.status(400).json({ error: "Referral already claimed!" });
        }

        // 2. Referrer (Dost) Ka Code Check Karo
        const referrer = await User.findOne({ referralCode: promoCode });
        if (!referrer) return res.status(400).json({ error: "Invalid VIP Code!" });
        if (referrer.deviceId === deviceId) return res.status(400).json({ error: "Cannot use your own code!" });

        // 3. Dost Ko ₹10 Bonus Do
        referrer.balance += 10.00; 
        referrer.totalInvites += 1; 
        await referrer.save();

        // 4. Naye User ki profile update karo
        user.referredBy = referrer.deviceId; 
        user.hardwareId = hardwareId; 
        user.hasClaimedReferral = true; 
        await user.save();

        // 🛡️ 5. PHONE KO HAMESHA KE LIYE BLACKLIST KAR DO
        if (hardwareId && hardwareId !== "unknown_device") {
            await new UsedDevice({ hardwareId: hardwareId }).save().catch(() => {}); // Error ignore if already exists
        }

        res.json({ success: true, message: "Referral Applied!" });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// 🗑️ SECURE DELETE USER ACCOUNT
app.post('/deleteUser', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; // 🛡️ Firebase Token Email
    if (!deviceId) return res.status(400).json({ error: "Missing data" });

    try {
        const deletedUser = await User.findOneAndDelete({ deviceId });
        if (!deletedUser) {
            return res.status(404).json({ error: "User not found" });
        }
        
        // Agar uska koi pending payout hai, usko bhi delete kar sakte ho (Optional but good practice)
        await Payout.deleteMany({ deviceId: deviceId, status: "Pending" });

        console.log(`🗑️ ACCOUNT DELETED: ${deviceId}`);
        res.json({ success: true, message: "Account completely wiped." });
    } catch (e) {
        res.status(500).json({ error: "Server Error during deletion" });
    }
});

// ==========================================
// 🔐 SECURE ADMIN ROUTES
// ==========================================
const adminAuth = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    const ADMIN_USER = process.env.ADMIN_USER; 
    const ADMIN_PASS = process.env.ADMIN_PASS; 
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
// 💸 NAYA: PAYOUT REJECT AND REFUND SYSTEM
app.post('/admin/reject', adminAuth, async (req, res) => {
    const { payoutId } = req.body; 
    try {
        const payout = await Payout.findById(payoutId);
        if (!payout || payout.status !== "Pending") {
            return res.status(400).json({ error: "Invalid or already processed payout" });
        }

        // User ko dhundh kar uske paise wapas (Refund) karo
        const user = await User.findOne({ deviceId: payout.deviceId });
        if (user) {
            user.balance += payout.amount;
            await user.save();
        }

        // Payout ko cancel kar do
        payout.status = "Rejected"; 
        await payout.save();

        res.json({ success: true, message: "Payment Rejected & Refunded to User!" });
    } catch(e) {
        res.status(500).json({ error: "Failed to reject payout" });
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
    // Server ab Hindi data ko bhi extract karega
    const { question_en, question_hi, options_en, options_hi, correctAnswer } = req.body;
    try {
        const newQuestion = new LiveQuestion({ 
            question_en, 
            question_hi, 
            options_en, 
            options_hi, 
            correctAnswer 
        });
        await newQuestion.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Indian Server running on Port ${PORT}`); });
