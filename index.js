const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// नकली डेटाबेस (Temporary Memory)
let users = {}; 

// 1. जब ऐप कनेक्ट होगा
app.post('/connect', (req, res) => {
    const { deviceId } = req.body;
    
    if (!users[deviceId]) {
        users[deviceId] = { 
            balance: 0.00, 
            dataSold: 0.00,
            status: 'Online' 
        };
        console.log(`New User Joined: ${deviceId}`);
    } else {
        console.log(`User Reconnected: ${deviceId}`);
    }
    res.json({ success: true, message: "Connected", data: users[deviceId] });
});

// 2. जब ऐप पिंग करेगा (पैसे कमाने के लिए)
app.post('/ping', (req, res) => {
    const { deviceId } = req.body;

    if (users[deviceId]) {
        // SIMULATION: हर पिंग पर थोड़ा डाटा और पैसा बढ़ाओ
        const mbSold = 2.0; 
        const earnings = 0.004; // $0.004 per ping

        users[deviceId].dataSold += mbSold;
        users[deviceId].balance += earnings;

        // टर्मिनल में लाइव कमाई दिखाओ
        console.log(`User ${deviceId}: Balance $${users[deviceId].balance.toFixed(4)} | Data: ${users[deviceId].dataSold.toFixed(2)} MB`);

        res.json({
            success: true,
            balance: users[deviceId].balance.toFixed(4),
            dataSold: users[deviceId].dataSold.toFixed(2)
        });
    } else {
        res.status(404).json({ success: false, message: "User not found" });
    }
});

// SERVER START (UPDATED FOR MOBILE ACCESS)
// '0.0.0.0' ka matlab hai server ab local network par visible hoga
app.listen(PORT, '0.0.0.0', () => {
    console.log(`-------------------------------------------`);
    console.log(`🚀 VELOCITA SERVER RUNNING ON PORT ${PORT}`);
    console.log(`   Network Access: http://192.168.0.8:${PORT}`); // Aapka IP dikhayega
    console.log(`   Waiting for App to connect...`);
    console.log(`-------------------------------------------`);
});