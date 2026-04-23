require('dotenv').config(); // 👈 YEH LINE SABSE UPAR AAYEGI
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios'); 
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
// 🔥 REDIS SETUP (WITH BULLETPROOF FALLBACK)
// ==========================================
const redis = require('redis');
const redisClient = redis.createClient({ 
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' 
});

let isRedisConnected = false; 

redisClient.on('error', (err) => {
    console.log('❌ Redis Error (Falling back to MongoDB):', err.message);
    isRedisConnected = false;
});

redisClient.on('connect', () => {
    console.log('⚡ REDIS CONNECTED (Cache Engine Ready!)');
    isRedisConnected = true;
});

redisClient.connect().catch(() => {
    console.log("⚠️ Could not connect to Redis initially. Continuing with MongoDB only.");
});

// 🛡️ CUSTOM HELPERS: Safe Redis Functions (Crash hone nahi denge)
// 🛡️ CUSTOM HELPERS: Safe Redis Functions (Crash hone nahi denge)
const safeRedisGet = async (key) => {
    if (!isRedisConnected) return null;
    try { return await redisClient.get(key); } catch(e) { return null; } // ✅ Yahan redisClient hona chahiye
};

const safeRedisSet = async (key, value, options) => {
    if (!isRedisConnected) return;
    try { await redisClient.set(key, value, options); } catch(e) {} // ✅ Yahan redisClient hona chahiye
};

const safeRedisSetNX = async (key, value, ttlSeconds) => {
    // 1. Try Redis First
    if (isRedisConnected) {
        try { 
            const result = await redisClient.set(key, value, { NX: true, EX: ttlSeconds }); 
            return result === 'OK'; 
        } catch(e) { console.log("Redis Lock Failed, trying Mongo..."); }
    }
    
    // 2. 🛡️ MONGODB FALLBACK (Agar Redis down hai)
    try {
        await MutexLock.create({ key: key });
        return true; 
    } catch (e) {
        if (e.code === 11000) return false; 
        return true; 
    }
};

const safeRedisDel = async (key) => {
    if (isRedisConnected) {
        try { await redisClient.del(key); } catch(e) {}
    }
    try { await MutexLock.deleteOne({ key: key }); } catch (e) {} 
};

// ==========================================
// 🕒 IST TIMEZONE HELPER
// ==========================================
const getISTDateString = () => {
    return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).substring(0, 10);
};

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
// 🛡️ NAYA: MongoDB Lock Schema (Auto-deletes after 15 seconds)
const mutexLockSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    createdAt: { type: Date, expires: 15, default: Date.now } 
});
const MutexLock = mongoose.model('MutexLock', mutexLockSchema);

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
    dealType: { type: String, default: "Normal" }, 
    closerName: { type: String, default: "" },     
    closerPhone: { type: String, default: "" },    
    status: { type: String, default: "Pending" }, 
    date: { type: Date, default: Date.now }
});
const SolarLead = mongoose.model('SolarLead', solarLeadSchema);
// 🧘‍♂️ YOGA LEAD MODEL
const yogaLeadSchema = new mongoose.Schema({
    submittedBy: { type: String, required: true }, 
    studentName: { type: String, required: true },
    studentPhone: { type: String, required: true }, 
    utrNumber: { type: String, required: true, unique: true }, 
    status: { type: String, default: "Pending" }, 
    date: { type: Date, default: Date.now }
});
const YogaLead = mongoose.model('YogaLead', yogaLeadSchema);

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
// 🛡️ ANTI-HACK: IP Tracker to block App Cloners and Bot Farms
const ipTrackerSchema = new mongoose.Schema({
    ipAddress: { type: String, required: true, unique: true },
    count: { type: Number, default: 1 },
    lastUsed: { type: Date, default: Date.now }
});
const IPTracker = mongoose.model('IPTracker', ipTrackerSchema);

// 🛡️ ANTI-HACK: Offerwall Transaction Log
const offerwallTxSchema = new mongoose.Schema({
    txId: { type: String, required: true, unique: true },
    deviceId: String,
    amount: Number,
    date: { type: Date, default: Date.now }
});
const OfferwallTx = mongoose.model('OfferwallTx', offerwallTxSchema);


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

// 🔔 4. THE 8:50 PM ALARM (Ghost Token Cleaner & Safe Sender)
cron.schedule('50 20 * * *', async () => {
    console.log("🔔 8:50 PM: Sending FCM Notification in batches...");
    try {
        const cursor = User.find({ fcmToken: { $ne: "", $exists: true } }).select('fcmToken deviceId').cursor();
        let tokens = [];
        
        for await (const doc of cursor) {
            tokens.push(doc.fcmToken);
            
            if (tokens.length === 500) { 
                const response = await admin.messaging().sendEachForMulticast({
                    notification: { title: "🔥 KBC Arena starts in 5 mins!", body: "Hurry up! Win ₹50,000 Cash! Open the app now! 💸" },
                    tokens: tokens
                }).catch(e => console.log("Batch push failed, ignoring..."));

                // 🧹 GHOST TOKEN CLEANUP LOGIC
                if (response && response.failureCount > 0) {
                    const failedTokens = [];
                    response.responses.forEach((resp, idx) => {
                        if (!resp.success && (resp.error.code === 'messaging/registration-token-not-registered' || resp.error.code === 'messaging/invalid-registration-token')) {
                            failedTokens.push(tokens[idx]);
                        }
                    });
                    if (failedTokens.length > 0) {
                        await User.updateMany({ fcmToken: { $in: failedTokens } }, { $set: { fcmToken: "" } });
                    }
                }
                tokens = []; 
            }
        }
        
        if (tokens.length > 0) { 
            const response = await admin.messaging().sendEachForMulticast({
                notification: { title: "🔥 KBC Arena starts in 5 mins!", body: "Hurry up! Win ₹50,000 Cash! Open the app now! 💸" },
                tokens: tokens
            }).catch(e => {});

            if (response && response.failureCount > 0) {
                const failedTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success && (resp.error.code === 'messaging/registration-token-not-registered' || resp.error.code === 'messaging/invalid-registration-token')) {
                        failedTokens.push(tokens[idx]);
                    }
                });
                if (failedTokens.length > 0) {
                    await User.updateMany({ fcmToken: { $in: failedTokens } }, { $set: { fcmToken: "" } });
                }
            }
        }
        console.log(`✅ Safely sent all notifications and cleaned DB!`);
    } catch(e) { console.error("❌ FCM Error:", e); }
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


const verifyAppSignature = async (req, res, next) => {
    const signature = req.headers['x-velo-signature'];
    const timestamp = req.headers['x-velo-timestamp'];
    const nonce = req.headers['x-velo-nonce'];
    const authHeader = req.headers['authorization']; 

    if (!signature || !timestamp || !nonce || !authHeader) {
        return res.status(403).json({ error: "🛑 ACCESS DENIED: Missing Security Headers" });
    }

    // 1. FIREBASE AUTH CHECK (Botnet Killer)
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(403).json({ error: "🛑 INVALID AUTH FORMAT" });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.userEmail = decodedToken.email; 
    } catch (err) {
        console.log(`🚨 FAKE GOOGLE LOGIN ATTEMPT: ${req.ip}`);
        return res.status(403).json({ error: "🛑 FAKE ACCOUNT BLOCKED!" });
    }

    // 2. REPLAY ATTACK CHECK (Time Machine Killer - 60s Strict Window)
    const now = Date.now();
    if (Math.abs(now - parseInt(timestamp)) > 60000) { 
        return res.status(403).json({ error: "🛑 EXPIRED REQUEST" });
    }
    
    // 🔥 REDIS NONCE CACHE
    const isNonceUsed = await safeRedisGet(`nonce_${nonce}`);
    if (isNonceUsed) {
        console.log(`🚨 REPLAY ATTACK BLOCKED from ${req.userEmail}`);
        return res.status(403).json({ error: "🛑 REQUEST ALREADY USED!" });
    }
    await safeRedisSet(`nonce_${nonce}`, "used", { EX: 60 });

    // 3. HMAC SIGNATURE CHECK (Tamper Proofing & Crash Prevention)
    try {
        const payloadString = req.rawBody ? String(req.rawBody) : ""; 
        const expectedSignature = crypto.createHmac('sha256', APP_SECRET)
                                        .update(payloadString + timestamp + nonce) 
                                        .digest('hex');

        if (signature !== expectedSignature) {
            console.log(`🚨 SIGNATURE MISMATCH for ${req.userEmail}`);
            return res.status(403).json({ error: "🛑 INVALID SIGNATURE OR TAMPERED DATA" });
        }
    } catch (hashError) {
        console.error("❌ Hash Generation Error:", hashError.message);
        return res.status(500).json({ error: "🛑 SECURITY PROCESSING ERROR" });
    }

    // 4. IDENTITY MISMATCH CHECK
    if (req.body && req.body.deviceId && req.body.deviceId !== req.userEmail) {
        return res.status(403).json({ error: "🛑 IDENTITY THEFT BLOCKED!" });
    }

    next();
};

// ==========================================
// 🔓 PUBLIC ROUTES (For Flutter App)
// ==========================================

app.get('/', (req, res) => { res.send("VELOCITA INDIAN SERVER IS ONLINE 🇮🇳"); });

// ==========================================
// 💎 PREMIUM DEALS ENGINE (vCommission Pull API)
// ==========================================

// 🧠 Smart Category Mapper Helper
const mapCategory = (title, category) => {
    const text = (title + " " + category).toLowerCase();
    if (text.includes("demat") || text.includes("trading") || text.includes("stock") || text.includes("upstox") || text.includes("angel")) return "Demat Accounts";
    if (text.includes("credit card") || text.includes("sbi card") || text.includes("hdfc card")) return "Credit Cards";
    if (text.includes("bank") || text.includes("saving") || text.includes("account") || text.includes("kotak")) return "Bank Accounts";
    return "Finance";
};

// 🚀 Route 1: App ko filtered premium deals bhejna
app.post('/premium-deals', verifyAppSignature, async (req, res) => {
    try {
        // ⚡ 1. CHECK CACHE FIRST (Cache key name changed to bust old cache)
        const cachedDeals = await safeRedisGet('premium_deals_cache_v3');
        if (cachedDeals && JSON.parse(cachedDeals).length > 0) {
            return res.json(JSON.parse(cachedDeals));
        }

        console.log("Fetching fresh campaigns from vCommission...");

        // 🌐 2. FETCH FROM VCOMMISSION API
        const vcommKey = process.env.VCOMM_API_KEY || "69d4ac2c5e5c12a3e88d2662c8469d4ac2c5e604";
        const vCommUrl = `https://api.vcommission.com/v2/publisher/campaigns?apikey=${vcommKey}`;
        const response = await axios.get(vCommUrl);

        const campaigns = response.data?.data?.campaigns || response.data?.campaigns || []; 
        const processedDeals = [];

        // 🧹 3. THE SMART FILTER ENGINE
        for (const camp of campaigns) {
            const title = camp.title || camp.campaign_name || camp.name || "";
            const status = (camp.status || "").toLowerCase();
            const countries = (camp.countries || camp.geo || "").toString().toUpperCase();
            
            if (status !== 'active' && status !== 'approved') continue;
            if (!countries.includes('IN') && !countries.includes('INDIA')) continue;

            // --- SMART PAYOUT PARSER START ---
            let rawPayout = camp.payout_revenue || camp.payout || camp.default_payout || "0";
            let payoutString = rawPayout.toString().toUpperCase();
            let basePayout = parseFloat(payoutString.replace(/[^0-9.]/g, '')) || 0; 
            
            if (payoutString.includes('$') || payoutString.includes('USD') || (camp.currency && camp.currency.toUpperCase() === 'USD')) {
                const exchangeRate = parseFloat(process.env.USD_RATE) || 83.0; 
                basePayout = basePayout * exchangeRate; 
            }
            // --- SMART PAYOUT PARSER END ---

            // 🛑 RULE 3: MINIMUM ₹429 CHECK
            if (basePayout >= 429) {
                processedDeals.push({
                    id: camp.campaign_id || camp.id,
                    brand: camp.advertiser_name || title.split(' ')[0] || "Premium Brand",
                    title: title,
                    category: mapCategory(title, camp.category || ""),
                    desc: "Complete the account opening process to unlock your high-ticket reward.", // Clean static desc
                    basePayout: basePayout,
                    timeToTrack: "24 - 48 Hrs", 
                    tracking_url: camp.tracking_url || "" 
                });
            }
        }

        console.log(`🎯 Premium Deals: ${processedDeals.length} valid Indian campaigns found.`);

        // 💾 4. SAVE TO REDIS (Cache for 30 mins)
        if (processedDeals.length > 0) {
            await safeRedisSet('premium_deals_cache_v3', JSON.stringify(processedDeals), { EX: 1800 });
        }
        
        res.json(processedDeals);

    } catch (error) {
        console.error("❌ Premium Deals Fetch Error:", error.message);
        const oldData = await safeRedisGet('premium_deals_cache_v3');
        if (oldData) return res.json(JSON.parse(oldData));
        res.status(500).json({error: "Failed to fetch deals"});
    }
});

// 🚀 Route 2: Secure Redirector (Browser me link kholne ke liye)
app.get('/redirect', async (req, res) => {
    const { camp, uid } = req.query; // camp = Campaign ID, uid = User Email
    
    if (!camp || !uid) {
        return res.status(400).send("Invalid Tracking Link. Missing Parameters.");
    }

    try {
        let targetUrl = "";
        
        // Redis cache se original link nikalenge
        const cachedDeals = await safeRedisGet('premium_deals_cache');
        if (cachedDeals) {
            const deals = JSON.parse(cachedDeals);
            const deal = deals.find(d => d.id == camp);
            if (deal && deal.tracking_url) {
                targetUrl = deal.tracking_url;
            }
        }

        // Fallback generic link
        if (!targetUrl) {
             const baseUrl = process.env.VCOMM_DEFAULT_TRACKING_URL || "https://tracking.vcommission.com/click";
             targetUrl = `${baseUrl}?campaign_id=${camp}`; 
        }

        // SECURE APPEND: Add user's email in the `p2` parameter (Trackier uses p1 for click_id)
const finalUrl = targetUrl.includes('?') 
    ? `${targetUrl}&p2=${uid}` 
    : `${targetUrl}?p2=${uid}`;

        console.log(`🔗 Redirecting User ${uid} to Campaign ${camp}`);
        res.redirect(finalUrl);

    } catch (e) {
        console.error("❌ Redirect Error:", e);
        res.status(500).send("Redirection Error. Please try again.");
    }
});

// ==========================================
// 💸 REGULAR DEALS ENGINE (50/50 Split, Min ₹10 Profit)
// ==========================================
app.post('/regular-deals', verifyAppSignature, async (req, res) => {
    try {
        // ⚡ 1. CHECK CACHE FIRST 
        const cachedDeals = await safeRedisGet('regular_deals_cache_v3');
        if (cachedDeals && JSON.parse(cachedDeals).length > 0) {
            return res.json(JSON.parse(cachedDeals));
        }

        console.log("Fetching fresh REGULAR campaigns from vCommission...");

        const vcommKey = process.env.VCOMM_API_KEY || "69d4ac2c5e5c12a3e88d2662c8469d4ac2c5e604";
        const vCommUrl = `https://api.vcommission.com/v2/publisher/campaigns?apikey=${vcommKey}`;
        const response = await axios.get(vCommUrl);
       
        const campaigns = response.data?.data?.campaigns || response.data?.campaigns || []; 
        const processedDeals = [];

        // 🧹 2. FILTER ENGINE FOR REGULAR TASKS
        for (const camp of campaigns) {
            const title = camp.title || camp.campaign_name || camp.name || "";
            const status = (camp.status || "").toLowerCase();
            const countries = (camp.countries || camp.geo || "").toString().toUpperCase();
            
            if (status !== 'active' && status !== 'approved') continue;
            if (!countries.includes('IN') && !countries.includes('INDIA')) continue;

            // --- SMART PAYOUT PARSER START ---
            let rawPayout = camp.payout_revenue || camp.payout || camp.default_payout || "0";
            let payoutString = rawPayout.toString().toUpperCase();
            let basePayout = parseFloat(payoutString.replace(/[^0-9.]/g, '')) || 0; 
            
            if (payoutString.includes('$') || payoutString.includes('USD') || (camp.currency && camp.currency.toUpperCase() === 'USD')) {
                basePayout = basePayout * 83; // USD to INR conversion
            }
            // --- SMART PAYOUT PARSER END ---

            // 🛑 RULE: Minimum Base Payout ₹20 (50% is ₹10) AND Maximum ₹500
            if (basePayout >= 20 && basePayout <= 500) {
                processedDeals.push({
                    id: camp.campaign_id || camp.id,
                    brand: camp.advertiser_name || title.split(' ')[0] || "Quick Task",
                    title: title,
                    category: "Tasks", 
                    desc: "Complete this task properly to earn your reward.", 
                    basePayout: basePayout,
                    timeToTrack: "24 Hrs", 
                    tracking_url: camp.tracking_url || "" 
                });
            }
        }

        console.log(`🎯 Regular Deals: ${processedDeals.length} valid Indian campaigns found.`);

        // 💾 3. SAVE TO REDIS
        if (processedDeals.length > 0) {
            await safeRedisSet('regular_deals_cache_v3', JSON.stringify(processedDeals), { EX: 1800 });
        }
        
        res.json(processedDeals);

    } catch (error) {
        console.error("❌ Regular Deals Fetch Error:", error.message);
        const oldData = await safeRedisGet('regular_deals_cache_v3');
        if (oldData) return res.json(JSON.parse(oldData));
        res.status(500).json({error: "Failed to fetch regular deals"});
    }
});

// ==========================================
// 🔔 SECURE ROUTE: SAVE FCM TOKEN FOR NOTIFICATIONS
// ==========================================
app.post('/update-fcm', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; // verifyAppSignature middleware se aayega
    const { fcmToken } = req.body;
    
    if (!deviceId || !fcmToken) {
        return res.status(400).json({ error: "Missing FCM token" });
    }

    try {
        // 1. Update token in MongoDB safely
        await User.updateOne(
            { deviceId: deviceId }, 
            { $set: { fcmToken: fcmToken } }
        );
        
        // 2. Update token in Redis Cache (Bohot zaroori hai taaki cache out-of-sync na ho)
        const redisKey = `user_${deviceId}`;
        const cachedUser = await safeRedisGet(redisKey);
        
        if (cachedUser) {
            let userObj = JSON.parse(cachedUser);
            userObj.fcmToken = fcmToken;
            await safeRedisSet(redisKey, JSON.stringify(userObj), { EX: 900 });
        }

        console.log(`🔔 FCM Token successfully saved for: ${deviceId}`);
        res.json({ success: true, message: "Token safely stored for KBC notifications." });

    } catch (e) {
        console.error("❌ FCM Token Save Error:", e);
        res.status(500).json({ error: "Server Error while saving token." });
    }
});

// A. PING (Now Secured & Redis Cached! ⚡)
app.post('/ping', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; 
    const { usage } = req.body;
    if (!deviceId) return res.status(400).json({ error: "No ID" });

    try {
        let user;
        const redisKey = `user_${deviceId}`;

        // ⚡ 1. TRY REDIS FIRST
        const cachedUser = await safeRedisGet(redisKey);

        if (cachedUser) {
            user = JSON.parse(cachedUser); 
        } else {
            // 🐢 2. CACHE MISS: MONGODB SE LO
            user = await User.findOne({ deviceId }).lean(); 
            
            if (!user) {
                const baseName = deviceId.split('@')[0].toUpperCase();
                const newUser = new User({ deviceId, referralCode: "VELO-" + baseName });
                await newUser.save();
                user = newUser.toObject();
            }
        }

        const now = new Date();
        const today = getISTDateString(); 
        let needsDbUpdate = false; 

        // 🔥 Daily Reset Logic
        if (user.lastTaskDate !== today) { 
            user.dailyTaskEarnings = 0; 
            user.lastTaskDate = today; 
            user.scratchCountToday = 0; 
            user.dailyTaskMeter = 0;             
            user.goldenPassUnlocked = false;     
            user.isEliminatedToday = false; 
            needsDbUpdate = true;
        }

        const diff = (now - new Date(user.lastActive)) / 1000;
        
        if (diff > 8) { 
            const userRatePerMB = 0.00486; 
            const actualUsageMB = parseFloat(usage) || 0; 
            let earning = actualUsageMB * userRatePerMB; 

            if (earning > 0 && user.dailyTaskEarnings + earning <= 50.0) {
                user.balance += earning;
                user.dailyTaskEarnings += earning;
                needsDbUpdate = true;
                
                if (user.referredBy && !user.hasWithdrawnEver) {
                    const upline = await User.findOne({ deviceId: user.referredBy });
                    if (upline) { 
                        const commission = earning * 0.10;
                        upline.balance = parseFloat((upline.balance + commission).toFixed(4)); 
                        await upline.save(); 
                    }
                }
            }
        }

        // 🛡️ FIX 4: INCREMENT TOTAL DATA, DON'T OVERWRITE
        if (usage && usage > 0) { 
            user.totalData = parseFloat((user.totalData + usage).toFixed(4)); 
            needsDbUpdate = true; 
        }
        // 💾 3. DATA CHANGE HUA HAI TOH DB AUR REDIS UPDATE KARO
        if (needsDbUpdate) {
            user.lastActive = now;
            await User.updateOne({ deviceId }, { $set: user }); 
            await safeRedisSet(redisKey, JSON.stringify(user), { EX: 900 });
        }

        res.json({ 
            status: "active", balance: parseFloat(user.balance).toFixed(4), 
            upiId: user.upiId, dailyTaskMeter: user.dailyTaskMeter, 
            isPassUnlocked: user.goldenPassUnlocked,
            totalInvites: user.totalInvites, networkEarnings: user.networkEarnings
        });
    } catch (e) { 
        res.status(500).json({ error: "Server Error" }); 
    }
});

// B. SECURE UPDATE BALANCE (With Auto-Clicker & Race Condition Protection)
app.post('/updateBalance', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail;
    const { taskId, dynamicAmount } = req.body; 
    if (!deviceId || !taskId) return res.status(400).json({ error: "Missing data" });

   // 🛡️ FIX 2: TRUE ATOMIC REDIS MUTEX LOCK
    const lockKey = `tx_lock_${deviceId}`;
    const lockAcquired = await safeRedisSetNX(lockKey, "LOCKED", 3);
    
    if (!lockAcquired) {
        console.log(`🚨 RACE CONDITION BLOCKED for ${deviceId}`);
        return res.status(429).json({ error: "⏳ Processing... please wait." });
    }

    try {
        const user = await User.findOne({ deviceId });
        if (!user) {
            await safeRedisDel(lockKey); 
            return res.status(404).json({ error: "User not found" });
        }

        const now = new Date();
        const today = getISTDateString();

        // 🔥 Daily Reset Logic
        if (user.lastTaskDate !== today) { 
            user.dailyTaskEarnings = 0; 
            user.lastTaskDate = today; 
            user.scratchCountToday = 0; 
            user.dailyTaskMeter = 0;            
            user.goldenPassUnlocked = false;    
            user.isEliminatedToday = false;     
        }

        // 🛑 1. DAILY BONUS HACK BLOCKER
        if (taskId === 'daily_bonus') {
            if (user.lastBonusDate === today) {
                await safeRedisDel(lockKey);
                return res.status(429).json({ error: "🚫 Hack Attempt! Bonus already claimed today." });
            }
            user.lastBonusDate = today; 
        }

        // 🛑 2. SCRATCH CARD HACK BLOCKER
        if (taskId === 'scratch_card') {
            if (user.scratchCountToday >= 5) {
                await safeRedisDel(lockKey);
                return res.status(429).json({ error: "🚫 Daily Scratch Limit Reached!" });
            }
            user.scratchCountToday += 1; 
        }

        // 🛑 3. RATE LIMITING
        if (user.lastTaskTime) {
            const timeDiff = (now - user.lastTaskTime) / 1000; 
            if (taskId === 'vip_radio_ping') {
                if (timeDiff < 55) { await safeRedisDel(lockKey); return res.status(429).json({ error: "⏳ Radio Speed Hack Detected!" }); }
            } else if (taskId !== 'daily_bonus' && taskId !== 'scratch_card' && !taskId.includes("Flash Task")) {
                if (timeDiff < 5) { await safeRedisDel(lockKey); return res.status(429).json({ error: "⏳ Too fast! System cooling down." }); }
            }
        }

        // 💰 REWARD ASSIGNMENT
        let finalAmount = 0;
        
        if (taskId === 'scratch_card') {
            const reqAmount = parseFloat(dynamicAmount) || 0;
            if (reqAmount >= 0.02 && reqAmount <= 0.10) {
                finalAmount = reqAmount;
            } else {
                console.log(`🚨 SCRATCH HACK BLOCKED: ${deviceId}`);
                finalAmount = 0.02; 
            }
        } else if (TASK_REWARDS[taskId]) {
            finalAmount = TASK_REWARDS[taskId]; 
            
        } else if (taskId === 'weekly_bonus') {
            // 🛡️ FIX: Day 7 Jackpot Hack Blocker
            const reqAmount = parseFloat(dynamicAmount) || 0;
            finalAmount = Math.min(reqAmount, 20.0); // Maximum Rs 20 hi allow karega
            if (finalAmount <= 0) finalAmount = 5.0; 
            
        } else if (taskId === 'flash_task' || taskId.startsWith("Flash Task")) {
            // 🛡️ FIX: Flash Task Hack Blocker
            const reqAmount = parseFloat(dynamicAmount) || 0;
            finalAmount = Math.min(reqAmount, 5.0); // Maximum Rs 5 hi allow karega
            if (finalAmount <= 0) finalAmount = 1.0; 
            
        } else if (taskId === 'unknown') {
            finalAmount = 0.05; // Fallback amount
            
        } else {
            await safeRedisDel(lockKey);
            return res.status(400).json({ error: "Invalid Task ID" });
        }

        const isBonusTask = (taskId === 'daily_bonus' || taskId === 'weekly_bonus');

        // 🛑 MAX DAILY LIMIT CHECK
        if (user.dailyTaskEarnings + finalAmount > 50.0 && !isBonusTask) {
            await safeRedisDel(lockKey);
            return res.status(429).json({ error: "Daily limit reached. Use Premium Offers for unlimited earning!" });
        }

        // 🧮 BALANCE UPDATE
        user.balance = parseFloat((user.balance + finalAmount).toFixed(4));
        if (!isBonusTask) {
            user.dailyTaskEarnings = parseFloat((user.dailyTaskEarnings + finalAmount).toFixed(4));
        }
        user.lastTaskTime = now; 

        // 💸 10% EARLY BIRD COMMISSION
        if (user.referredBy && !user.hasWithdrawnEver && !isBonusTask) {
            const upline = await User.findOne({ deviceId: user.referredBy });
            if (upline) {
                const commission = finalAmount * 0.10;
                // 🛡️ FIX 3: FLOAT MATH CORRECTION
                upline.balance = parseFloat((upline.balance + commission).toFixed(4));
                upline.networkEarnings = parseFloat((upline.networkEarnings + commission).toFixed(4));
                await upline.save();
            }
        }

        // 🎫 GOLD PASS METER UPDATE
        if (!isBonusTask) {
            user.dailyTaskMeter += finalAmount;
            if (user.dailyTaskMeter >= 50.0 && !user.goldenPassUnlocked) { user.goldenPassUnlocked = true; }
        }

        await user.save();
        
        const redisKey = `user_${deviceId}`;
        await safeRedisSet(redisKey, JSON.stringify(user), { EX: 900 });

        // 🛡️ KAAM POORA HONE KE BAAD LOCK KHOL DO
        await safeRedisDel(lockKey);

        res.json({ success: true, addedAmount: finalAmount, newBalance: user.balance, dailyMeter: user.dailyTaskMeter, isUnlocked: user.goldenPassUnlocked });
    } catch (e) { 
        console.error("Update Balance Error:", e);
        await safeRedisDel(lockKey); 
        res.status(500).json({ error: "Server Error" }); 
    }
});


// ==========================================
// 💸 SECURE SERVER-TO-SERVER POSTBACK (GET Method for CPX)
// ==========================================
app.get('/postback', async (req, res) => {
    // 🛡️ 1. PROPER IP EXTRACTION
    let incomingIp = req.socket.remoteAddress || "unknown_ip";
    if (req.headers['x-forwarded-for']) {
        incomingIp = req.headers['x-forwarded-for'].split(',')[0].trim();
    }
    // Handle IPv4 mapped IPv6 addresses (::ffff:)
    if (incomingIp.startsWith('::ffff:')) {
        incomingIp = incomingIp.substring(7);
    }

    // 🛡️ 2. STRICT IP WHITELISTING (CPX Servers Only)
    const allowedIPs = ['188.40.3.73', '157.90.97.92', '2a01:4f8:d0a:30ff::2'];
    if (!allowedIPs.includes(incomingIp)) {
        console.error(`🚨 FAKE IP BLOCKED! Attack from: ${incomingIp}`);
        return res.status(403).send("0");
    }

    // 🛡️ 3. SECRET KEY CHECK (Fix: CPX 'hash' bhejta hai)
    const secret = req.query.hash || req.query.secret; 
    if (secret !== process.env.OFFERWALL_SECRET) {
        console.error(`🚨 FAKE POSTBACK BLOCKED! Invalid Secret from IP: ${incomingIp}`);
        return res.status(403).send("0");
    }

    // 📦 EXTRACT VARIABLES
    const deviceId = req.query.userid || req.query.ext_user_id; 
    const amount = parseFloat(req.query.amount || req.query.reward);
    const txId = req.query.tx_id || req.query.transaction_id;
    const status = parseInt(req.query.status); // 🔥 NAYA: Fraud track karne ke liye

    if (!deviceId || isNaN(amount) || !txId) {
        return res.status(400).send("0"); 
    }

    try {
        const existingTx = await OfferwallTx.findOne({ txId });

        // 🛑 4. STATUS LOGIC (CRITICAL FOR FRAUD PREVENTION)
        // Agar CPX bole ki user ne fraud kiya hai (status = 2)
        if (status === 2) {
            console.log(`⚠️ CPX CANCELED/FRAUD DETECTED for Tx: ${txId}. No money added.`);
            if (!existingTx) {
                // Fraud record save kar lo future reference ke liye (amount = 0)
                await new OfferwallTx({ txId, deviceId, amount: 0, date: Date.now() }).save();
            }
            return res.status(200).send("1"); // CPX ko bata do hume cancel request mil gayi
        } 
        
        // Agar status 1 (Success) nahi hai, toh ignore karo
        if (status !== 1) {
            return res.status(200).send("1"); 
        }

        // --- YAHAN SE AAGE SIRF TAB AAYEGA JAB SURVEY 100% SUCCESS HO ---
        if (existingTx) return res.status(200).send("1"); // Pehle se paisa de chuke hain

        // 💰 Nayi successful transaction save karo
        await new OfferwallTx({ txId, deviceId, amount }).save();

        const user = await User.findOne({ deviceId });
        if (!user) return res.status(404).send("0");

        // 🧮 PAISE ADD KARO (Safe Decimal Math)
        user.balance = parseFloat((user.balance + amount).toFixed(4));
        user.dailyTaskMeter = parseFloat((user.dailyTaskMeter + amount).toFixed(4));

        if (user.dailyTaskMeter >= 50.0 && !user.goldenPassUnlocked) { 
            user.goldenPassUnlocked = true; 
        }

        // 💸 Upline Referral Commission (10%)
        if (user.referredBy && !user.hasWithdrawnEver) {
            const upline = await User.findOne({ deviceId: user.referredBy });
            if (upline) {
                const commission = amount * 0.10;
                upline.balance = parseFloat((upline.balance + commission).toFixed(4));
                upline.networkEarnings = parseFloat((upline.networkEarnings + commission).toFixed(4));
                await upline.save();
                // Redis Update
                const safeRedisSet = async (k, v, opt) => { try { await redisClient.set(k, v, opt); } catch(e){} };
                if (typeof safeRedisSet === 'function') {
                   await safeRedisSet(`user_${upline.deviceId}`, JSON.stringify(upline), { EX: 900 });
                }
            }
        }

        await user.save();
        
        // 💾 Main user ka Redis cache update karo
        if (typeof safeRedisSet === 'function') {
            await safeRedisSet(`user_${deviceId}`, JSON.stringify(user), { EX: 900 });
        }
        
        console.log(`✅ CPX Postback Success: ₹${amount} added for ${deviceId}`);
        res.status(200).send("1"); 
    } catch (e) {
        console.error("Postback Error:", e);
        res.status(500).send("0");
    }
});

// ==========================================
// 💎 SECURE POSTBACK FOR VCOMMISSION DEALS
// ==========================================
app.get('/vcomm-postback', async (req, res) => {
    // 🛡️ 1. SECRET KEY CHECK
    // Yahan hum wahi secret check kar rahe hain jo tumne URL me dala hai
    const secret = req.query.secret;
    if (secret !== process.env.OFFERWALL_SECRET) {
        console.error(`🚨 VCOMM FAKE POSTBACK BLOCKED! Invalid Secret.`);
        return res.status(403).send("Unauthorized");
    }

    // 📦 EXTRACT VARIABLES (As per your vCommission URL)
    const deviceId = req.query.userid; // URL mein {p2} se aayega
    const amount = parseFloat(req.query.reward); // URL mein {payout} se aayega
    const txId = req.query.tx_id; // URL mein {click_id} se aayega

    // Agar data missing hai toh error de do
    if (!deviceId || isNaN(amount) || !txId) {
        return res.status(400).send("Bad Request: Missing parameters");
    }

    try {
        // 🛑 DOUBLE ENTRY CHECK (Taaki ek task ka do baar paisa na mile)
        const existingTx = await OfferwallTx.findOne({ txId });
        if (existingTx) {
            console.log(`⚠️ vCommission Tx already processed: ${txId}`);
            return res.status(200).send("OK"); // Already processed
        }

        // 💰 Nayi successful transaction save karo
        await new OfferwallTx({ txId, deviceId, amount }).save();

        // 🧑 User dhundho
        const user = await User.findOne({ deviceId });
        if (!user) return res.status(404).send("User Not Found");

        // 🧮 PAISE ADD KARO
        user.balance = parseFloat((user.balance + amount).toFixed(4));
        user.dailyTaskMeter = parseFloat((user.dailyTaskMeter + amount).toFixed(4));

        if (user.dailyTaskMeter >= 50.0 && !user.goldenPassUnlocked) { 
            user.goldenPassUnlocked = true; 
        }

        // 💸 Upline Referral Commission (10%)
        if (user.referredBy && !user.hasWithdrawnEver) {
            const upline = await User.findOne({ deviceId: user.referredBy });
            if (upline) {
                const commission = amount * 0.10;
                upline.balance = parseFloat((upline.balance + commission).toFixed(4));
                upline.networkEarnings = parseFloat((upline.networkEarnings + commission).toFixed(4));
                await upline.save();
                
                // Redis Update
                const safeRedisSet = async (k, v, opt) => { try { await redisClient.set(k, v, opt); } catch(e){} };
                if (typeof safeRedisSet === 'function') {
                   await safeRedisSet(`user_${upline.deviceId}`, JSON.stringify(upline), { EX: 900 });
                }
            }
        }

        await user.save();
        
        // 💾 Main user ka Redis cache update karo
        if (typeof safeRedisSet === 'function') {
            await safeRedisSet(`user_${deviceId}`, JSON.stringify(user), { EX: 900 });
        }
        
        console.log(`✅ vCommission Deal Success: ₹${amount} added for ${deviceId}`);
        res.status(200).send("OK"); // vCommission expects a simple OK success response
        
    } catch (e) {
        console.error("vCommission Postback Error:", e);
        res.status(500).send("Server Error");
    }
});

// 🎯 LIVE ARENA ANSWER EVALUATOR
app.post('/submit-answer', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail;
    const { q_id, answer } = req.body;
    try {
        const user = await User.findOne({ deviceId });
        if (!user || user.isEliminatedToday || !user.goldenPassUnlocked) {
            return res.json({ success: false, message: "Eliminated or No Pass" });
        }

        const question = await LiveQuestion.findById(q_id);
        if (!question) return res.json({ success: false });

        const currentData = await db.ref('live_arena/current_question').once('value');
        const rtdbData = currentData.val();
        
        const serverTimeReceived = Date.now();
        const timeDiff = serverTimeReceived - rtdbData.timestamp;

        // 🛡️ BOT CHECK & TIMEOUT (1.5s to 12s window)
        if (timeDiff < 1500 || timeDiff > 12000 || answer !== question.correctAnswer) {
            user.isEliminatedToday = true;
            await user.save();
            return res.json({ success: false, message: "Eliminated" });
        }

        const today = getISTDateString();
        if (user.lastArenaWinDate !== today) {
            user.balance += 50.00; 
            user.lastArenaWinDate = today;
            await user.save();
            await safeRedisSet(`user_${deviceId}`, JSON.stringify(user), { EX: 900 });
            return res.json({ success: true, message: "Winner! ₹50 Added." });
        }

        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: "Server Error" });
    }
});

// 💸 BULLETPROOF WITHDRAW ROUTE
app.post('/withdraw', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail;
    const { method, details, amount } = req.body; 

    const lockKey = `withdraw_lock_${deviceId}`;
    const lockAcquired = await safeRedisSetNX(lockKey, "LOCKED", 15); 
    if (!lockAcquired) {
        return res.status(429).json({ error: "⏳ Transaction already in progress." });
    }

    try {
        const requestedAmount = Math.abs(parseFloat(amount)); 
        if (isNaN(requestedAmount) || requestedAmount < 50.0) {
            await safeRedisDel(lockKey);
            return res.status(400).json({ message: "Minimum ₹50 required." });
        }

        const user = await User.findOneAndUpdate(
            { deviceId: deviceId, balance: { $gte: requestedAmount } },
            { $inc: { balance: -requestedAmount }, $set: { hasWithdrawnEver: true, upiId: details } },
            { new: true }
        );

        if (!user) {
            await safeRedisDel(lockKey);
            return res.status(400).json({ message: "Insufficient balance!" });
        }

        await new Payout({ deviceId, amount: requestedAmount, method, details }).save();
        await safeRedisSet(`user_${deviceId}`, JSON.stringify(user), { EX: 900 });

        await safeRedisDel(lockKey);
        res.json({ status: "success", message: "Request Sent to Admin!" });
    } catch (e) { 
        await safeRedisDel(lockKey);
        res.status(500).json({ error: e.message }); 
    }
});
app.post('/submit-solar-lead', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; 
    const { customerName, mobileNumber, city, bill, dealType, closerName, closerPhone } = req.body;
    try {
        const existingLead = await SolarLead.findOne({ mobileNumber });
        if (existingLead) return res.status(400).json({ error: "Duplicate number!" });

        const newLead = new SolarLead({ 
            submittedBy: deviceId, 
            customerName, 
            mobileNumber, 
            city, 
            bill,
            dealType: dealType || "Normal",
            closerName: closerName || "",
            closerPhone: closerPhone || ""
        });
        await newLead.save();

        res.json({ success: true, message: "Lead submitted successfully!" });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// 🧘‍♂️ SUBMIT YOGA ADMISSION
app.post('/submit-yoga-lead', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; 
    const { studentName, studentPhone, utrNumber } = req.body;
    try {
        const existingLead = await YogaLead.findOne({ utrNumber });
        if (existingLead) return res.status(400).json({ error: "Duplicate UTR!" });

        const newLead = new YogaLead({ submittedBy: deviceId, studentName, studentPhone, utrNumber });
        await newLead.save();

        res.json({ success: true, message: "Yoga Admission submitted!" });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// GET se POST kiya, aur req.query se req.body kiya!
app.post('/my-solar-leads', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; // 🛡️ Firebase Token Email 
    try { const leads = await SolarLead.find({ submittedBy: deviceId }).sort({ date: -1 }); res.json(leads); } 
    catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// 🛡️ FIX 2: Added Skip and Limit logic for proper Pagination
app.post('/my-transactions', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; 
    const page = parseInt(req.body.page) || 1; // App se page number aayega, default 1
    const limit = 20; // Ek baar me 20 transactions bhejenge
    const skip = (page - 1) * limit;

    try { 
        const payouts = await Payout.find({ deviceId })
                                    .sort({ date: -1 })
                                    .skip(skip)
                                    .limit(limit); 
        res.json(payouts); 
    } catch (e) { 
        console.error("❌ Transaction Fetch Error:", e);
        res.status(500).json({ error: "Server Error" }); 
    }
});

app.post('/bindReferral', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; 
    const { hardwareId, promoCode } = req.body;
    
    // 🌐 NAYA: Extract actual IP Address of the user
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown_ip";

    try {
        // 🛡️ 1. IP ADDRESS RATE LIMITING (Bot Farm Killer)
        if (clientIp !== "unknown_ip") {
            const ipRecord = await IPTracker.findOne({ ipAddress: clientIp });
            if (ipRecord && ipRecord.count >= 2) {
                console.log(`🚨 BOT FARM BLOCKED: IP ${clientIp} exceeded referral limit!`);
                return res.status(403).json({ error: "Multiple accounts detected from your network. Claim blocked!" });
            }
        }

        // 🛡️ 2. HARDWARE ID BLACKLIST CHECK
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

        // 3. Referrer (Dost) Ka Code Check Karo
        const referrer = await User.findOne({ referralCode: promoCode });
        if (!referrer) return res.status(400).json({ error: "Invalid VIP Code!" });
        if (referrer.deviceId === deviceId) return res.status(400).json({ error: "Cannot use your own code!" });

        // 4. Dost Ko ₹10 Bonus Do Safely
        referrer.balance = parseFloat((referrer.balance + 10.00).toFixed(4)); 
        referrer.totalInvites += 1; 
        await referrer.save();
        await safeRedisSet(`user_${referrer.deviceId}`, JSON.stringify(referrer), { EX: 900 }); 

        // 5. Naye User ki profile update karo
        user.referredBy = referrer.deviceId; 
        user.hardwareId = hardwareId; 
        user.hasClaimedReferral = true; 
        await user.save();
        await safeRedisSet(`user_${deviceId}`, JSON.stringify(user), { EX: 900 }); 

        // 🛡️ 6. PHONE KO HAMESHA KE LIYE BLACKLIST KAR DO
        if (hardwareId && hardwareId !== "unknown_device") {
            await new UsedDevice({ hardwareId: hardwareId }).save().catch(() => {}); 
        }

        // 🛡️ 7. IP ADDRESS KO TRACK KARO
        if (clientIp !== "unknown_ip") {
            await IPTracker.findOneAndUpdate(
                { ipAddress: clientIp },
                { $inc: { count: 1 }, $set: { lastUsed: Date.now() } },
                { upsert: true }
            );
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
        await safeRedisDel(`user_${deviceId}`); // 🔥 NAYA: Redis se bhi uda do
        
        
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
            await safeRedisSet(`user_${user.deviceId}`, JSON.stringify(user), { EX: 900 }); // 🔥 NAYA
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
            if (user) { 
                // 🔥 SMART CHECK: Payout decide karo deal type ke hisaab se
                const payoutAmount = lead.dealType === "Crack Deal" ? 5000.00 : 1500.00;
                
                user.balance += payoutAmount; 
                await user.save(); 
                await safeRedisSet(`user_${user.deviceId}`, JSON.stringify(user), { EX: 900 }); 
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

// 🧘‍♂️ ADMIN YOGA ROUTES
app.get('/admin/yoga-leads', adminAuth, async (req, res) => {
    try { const leads = await YogaLead.find().sort({ date: -1 }); res.json(leads); } catch (e) { res.status(500).json({ error: "Error" }); }
});

app.post('/admin/update-yoga-lead', adminAuth, async (req, res) => {
    const { leadId, newStatus } = req.body;
    try {
        const lead = await YogaLead.findById(leadId);
        if (!lead) return res.status(404).json({ error: "Lead not found" });
        if (lead.status === "Paid") return res.status(400).json({ error: "Already Paid." });

        lead.status = newStatus; await lead.save();

        if (newStatus === "Paid") {
            const user = await User.findOne({ deviceId: lead.submittedBy });
            if (user) { 
                user.balance += 300.00; // 👈 USER KO YAHAN SE ₹300 MILENGE
                await user.save(); 
                await safeRedisSet(`user_${user.deviceId}`, JSON.stringify(user), { EX: 900 }); 
            }
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

// ==========================================
// 📊 UNIFIED LEADS LEDGER (BankSathi Model)
// ==========================================
app.post('/my-unified-ledger', verifyAppSignature, async (req, res) => {
    const deviceId = req.userEmail; 
    try {
        // Teeno collections se user ka data fetch karo
        const solarLeads = await SolarLead.find({ submittedBy: deviceId }).lean();
        const yogaLeads = await YogaLead.find({ submittedBy: deviceId }).lean();
        const dealLeads = await OfferwallTx.find({ deviceId }).lean(); // vCommission Postbacks

        let unifiedList = [];

        // ☀️ Solar Formatting
        solarLeads.forEach(lead => {
            unifiedList.push({
                id: lead._id.toString(),
                type: 'Solar',
                title: lead.customerName || 'Solar Client',
                subtitle: lead.dealType || 'Simple Lead',
                status: lead.status || 'Pending',
                amount: lead.dealType === 'Crack Deal' ? '5000' : '1500',
                date: lead.date
            });
        });

        // 🧘‍♂️ Yoga Formatting
        yogaLeads.forEach(lead => {
            unifiedList.push({
                id: lead._id.toString(),
                type: 'Yoga',
                title: lead.studentName || 'Yoga Student',
                subtitle: `UTR: ${lead.utrNumber}`,
                status: lead.status || 'Pending',
                amount: '300',
                date: lead.date
            });
        });

        // 💼 vCommission Deals Formatting
        dealLeads.forEach(tx => {
            unifiedList.push({
                id: tx._id.toString(),
                type: 'Deal',
                title: 'Brand Partner Deal',
                subtitle: `TxID: ${tx.txId}`,
                status: 'Verified', // Postbacks hamesha successful deals ke hi aate hain
                amount: tx.amount.toString(),
                date: tx.date
            });
        });

        // ⏳ Sort combined list by Date (Newest first)
        unifiedList.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(unifiedList);
    } catch (e) {
        console.error("Unified Ledger Error:", e);
        res.status(500).json({ error: "Server Error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Indian Server running on Port ${PORT}`); });
