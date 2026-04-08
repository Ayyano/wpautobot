require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;
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
    if (!FIREBASE_URL) {
        console.error("❌ ERROR: FIREBASE_URL is missing in environment variables!");
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["JavaGoat", "Safari", "1.0.0"] 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.clear(); 
            console.log('\n==================================================');
            console.log('📱 SCAN THIS QR CODE WITH WHATSAPP');
            console.log('==================================================\n');
            qrcode.generate(qr, { small: true }); 
        }

        if (connection === 'open') console.log('✅ JAVAGOAT AI IS ONLINE!');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ Connection closed. Reason: ${reason}`);
            if (reason !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconnecting...');
                startBot();
            } else {
                console.log('❌ Logged out. Please delete "session_data" folder and scan again.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;

            const sender = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

            console.log(`📩 Query from ${sender.split('@')[0]}: ${text}`);

            // Show typing indicator
            await sock.sendPresenceUpdate('composing', sender);

            if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
                const customerDetails = text; 
                const item = orderStates[sender].item;
                const customerWaNumber = sender.split('@')[0];

                const javaGoatOrder = {
                    userId: `whatsapp_${customerWaNumber}`,
                    userEmail: "whatsapp@javagoat.com",
                    phone: customerWaNumber,
                    address: customerDetails,
                    location: { lat: 0, lng: 0 },
                    items: [{
                        id: item.id,
                        name: item.name,
                        price: parseFloat(item.price),
                        img: item.imageUrl,
                        quantity: 1
                    }],
                    total: (parseFloat(item.price) + 50).toFixed(2),
                    status: "Placed",
                    method: "Cash on Delivery (WhatsApp)",
                    timestamp: new Date().toISOString()
                };

                const response = await fetch(`${FIREBASE_URL}/orders.json`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(javaGoatOrder)
                });

                if (!response.ok) throw new Error("Failed to save order to Firebase");

                await sock.sendMessage(sender, { 
                    text: `✅ *Order Placed Successfully!*\n\nThank you! Your order for *${item.name}* is being prepared.\n\n*Total:* ₹${javaGoatOrder.total} (Inc. Delivery)\n*Status:* Preparing\n\nWe will deliver it to your address soon.` 
                });
                
                delete orderStates[sender]; 
                return;
            }

            if (text.startsWith("order ")) {
                const productRequested = text.replace("order ", "").trim();
                const currentMenu = await getMenuFromApp();
                const matchedItem = currentMenu.find(item => item.name.toLowerCase().includes(productRequested));

                if (!matchedItem) {
                    await sock.sendMessage(sender, { text: `❌ Sorry, we couldn't find *${productRequested}* in our menu today.\n\nType *menu* to see all available items.` });
                    return;
                }

                orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };
                const captionText = `🛒 *Order Started!*\n\nYou selected: *${matchedItem.name}* (₹${matchedItem.price})\n\nPlease reply with your *Full Name, Phone Number, and Delivery Address*.`;
                
                if (matchedItem.imageUrl) {
                    await sock.sendMessage(sender, { image: { url: matchedItem.imageUrl }, caption: captionText });
                } else {
                    await sock.sendMessage(sender, { text: captionText });
                }
            }
            else if (text === "order") { 
                await sock.sendMessage(sender, { text: "🛒 *How to order:*\nPlease type 'order' followed by the dish name.\nExample: *order pizza*" });
            }
            else if (text.match(/menu|price|list|food/)) {
                const currentMenu = await getMenuFromApp();
                if (currentMenu.length === 0) {
                    await sock.sendMessage(sender, { text: "⚠️ Our menu is currently updating. Please check back soon!" });
                    return;
                }

                let menuMessage = "🍔 *JAVAGOAT LIVE MENU* 🍕\n\n";
                currentMenu.forEach(item => { menuMessage += `🔸 *${item.name}* - ₹${item.price}\n`; });
                menuMessage += "\n_To order, reply with 'order [dish name]'_";
                
                await sock.sendMessage(sender, { text: menuMessage });
            }
            else if (text.match(/hi|hello|hey/)) {
                await sock.sendMessage(sender, { text: "👋 *Welcome to JavaGoat!*\n\nI am your AI Assistant. Type *menu* to see our delicious food, or type *order [dish]* to buy instantly!" });
            }
            else if (text.match(/contact|call/)) {
                await sock.sendMessage(sender, { text: "📞 *Contact JavaGoat:*\n\n- *Email:* support@javagoat.com" });
            }
            else {
                await sock.sendMessage(sender, { text: "🤔 I didn't quite catch that.\n\nType *menu* to see our food list, or *order [food]* to place an order!" });
            }
        } catch (error) {
            console.error("❌ Message handling error:", error);
        }
    });
}

startBot().catch(err => console.error("❌ Fatal Error:", err));
