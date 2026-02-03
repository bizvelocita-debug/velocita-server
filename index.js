const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// 1. DATABASE CONNECTION (Yahan aapka Naya Link hai)
// Note: Password mein '@' ko '%40' likha hai taaki error na aaye.
const MONGO_URI = "mongodb+srv://admin:Keshav%402829@cluster0.tcdl2wy.mongodb.net/velocita?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("✅ DATABASE CONNECTED (MongoDB)"))
.catch(err => console.error("❌ DB ERROR:", err));

// 2. DATA MODELS (User ka Khata)
const userSchema = new mongoose.Schema({
    email: String,
    balance: { type: Number, default: 0.0000 },
    dataSold: { type: Number, default: 0.00 },
    lastActive: Date
});
const User = mongoose.model('User', userSchema);

// 3. API ROUTES

// Root Route
app.get('/', (req, res) => {
    res.send("VELOCITA SERVER IS ONLINE & CONNECTED TO DB 🚀");
});

// CONNECT (Login/Start Mining)
app.post('/connect', async (req, res) => {
    const { deviceId } = req.body; // App se Email aayega
    if (!deviceId) return res.status(400).send("No ID");

    // Check karein agar user pehle se hai
    let user = await User.findOne({ email: deviceId });
    
    if (!user) {
        // Naya user banayein
        user = new User({ email: deviceId, balance: 0.0000, dataSold: 0.00 });
        await user.save();
        console.log(`🆕 NEW USER: ${deviceId}`);
    } else {
        console.log(`👋 WELCOME BACK: ${deviceId}`);
    }
    
    res.json({ status: "Connected", balance: user.balance.toFixed(4) });
});

// PING (Mining Update)
app.post('/ping', async (req, res) => {
    const { deviceId } = req.body;
    
    let user = await User.findOne({ email: deviceId });
    if (user) {
        // Har ping par thoda paisa aur data badhayein
        user.balance += 0.0001;
        user.dataSold += 0.05;
        user.lastActive = new Date();
        await user.save(); // Database mein SAVE karein
        
        res.json({ 
            status: "Active", 
            balance: user.balance.toFixed(4), 
            dataSold: user.dataSold.toFixed(2) 
        });
    } else {
        res.status(404).send("User not found");
    }
});

// ADMIN STATS (Aapke liye)
app.get('/admin/stats', async (req, res) => {
    const allUsers = await User.find();
    res.json(allUsers);
});

// SERVER START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on Port ${PORT}`);
});