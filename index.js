require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// Add this to your local .env file or GitHub Secrets:
// FIREBASE_URL=https://gen-lang-client-0120793291-default-rtdb.firebaseio.com
const FIREBASE_URL = process.env.FIREBASE_URL || "https://gen-lang-client-0120793291-default-rtdb.firebaseio.com";
const orderStates = {}; 

async function getMenuFromApp() {
    try {
        const response = await fetch(`${FIREBASE_URL}/dishes.json`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        if (!data) return [];
        
        return Object.keys(data).map(key => ({
            id: key,
            name: data[key].name,
            price: data[key].price,
            imageUrl: data[key].imageUrl || ""
        }));
    } catch (error) {
        console.error("❌ Failed to fetch menu:", error.message);
        return [];
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["CrownCafe", "Safari", "1.0.0"] 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.clear(); 
            console.log('\n==================================================');
            console.log('👑 SCAN THIS QR CODE FOR CROWN CAFE BOT');
            console.log('==================================================\n');
            qrcode.generate(qr, { small: true }); 
        }
        if (connection === 'open') console.log('✅ CROWN CAFE AI IS ONLINE!');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;

            const sender = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

            await sock.sendPresenceUpdate('composing', sender);

            if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
                const customerDetails = text; 
                const item = orderStates[sender].item;
                const customerWaNumber = sender.split('@')[0];

                const crownOrder = {
                    userId: `whatsapp_${customerWaNumber}`,
                    userEmail: "whatsapp@crowncafe.com",
                    phone: customerWaNumber,
                    address: customerDetails,
                    location: { lat: 34.1485, lng: 71.7402 }, // Default Charsadda coordinates
                    items: [{ id: item.id, name: item.name, price: parseFloat(item.price), img: item.imageUrl, quantity: 1 }],
                    total: (parseFloat(item.price) + 50).toFixed(2), // Delivery Fee
                    status: "Placed",
                    method: "Cash on Delivery",
                    timestamp: new Date().toISOString()
                };

                await fetch(`${FIREBASE_URL}/orders.json`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(crownOrder)
                });

                await sock.sendMessage(sender, { 
                    text: `✅ *Order Placed Successfully!*\n\nThank you for choosing Crown Cafe Charsadda!\nYour order for *${item.name}* is being prepared.\n\n*Total:* Rs. ${crownOrder.total} (Inc. Delivery)\n*Status:* Preparing\n\n📍 We will deliver to your address shortly. Need help? Call us at 0371-5300200.` 
                });
                delete orderStates[sender]; 
                return;
            }

            if (text.startsWith("order ")) {
                const productRequested = text.replace("order ", "").trim();
                const currentMenu = await getMenuFromApp();
                const matchedItem = currentMenu.find(item => item.name.toLowerCase().includes(productRequested));

                if (!matchedItem) {
                    await sock.sendMessage(sender, { text: `❌ Sorry, we couldn't find *${productRequested}*.\nType *menu* to see all available items.` });
                    return;
                }

                orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };
                const captionText = `🛒 *Order Started!*\n\nYou selected: *${matchedItem.name}* (Rs. ${matchedItem.price})\n\nPlease reply with your *Full Name, Phone Number, and Delivery Address in Charsadda*.`;
                
                if (matchedItem.imageUrl) await sock.sendMessage(sender, { image: { url: matchedItem.imageUrl }, caption: captionText });
                else await sock.sendMessage(sender, { text: captionText });
            }
            else if (text === "order") { 
                await sock.sendMessage(sender, { text: "🛒 *How to order:*\nPlease type 'order' followed by the dish name.\nExample: *order The Crown Premium Burger*" });
            }
            else if (text.match(/menu|price|list|food/)) {
                const currentMenu = await getMenuFromApp();
                if (currentMenu.length === 0) return await sock.sendMessage(sender, { text: "⚠️ Menu updating. Please check back!" });

                let menuMessage = "👑 *THE CROWN CAFE MENU* 👑\n📍 Tangi Road, Rajjar Bazar, Charsadda\n\n";
                currentMenu.forEach(item => { menuMessage += `🔸 *${item.name}* - Rs. ${item.price}\n`; });
                menuMessage += "\n_To order, reply with 'order [dish name]'_";
                
                await sock.sendMessage(sender, { text: menuMessage });
            }
            else if (text.match(/hi|hello|hey|salam|assalam/)) {
                await sock.sendMessage(sender, { text: "👑 *Welcome to The Crown Cafe, Charsadda!*\n\nI am your AI Assistant. Type *menu* to see our delicious Steaks, Pizzas, and Burgers, or type *order [dish]* to buy instantly!" });
            }
        } catch (error) { console.error("❌ Error:", error); }
    });
}

startBot();
