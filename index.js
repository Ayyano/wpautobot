const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");
const admin = require("firebase-admin");

// =========================
// FIREBASE SETUP
// =========================
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://gen-lang-client-0120793291-default-rtdb.firebaseio.com"
});

const db = admin.database();

// =========================
// MENU DATA
// =========================
const MENU = {
  pizza: 1200,
  burger: 850,
  "zinger burger": 950,
  fries: 350,
  shawarma: 500,
  biryani: 700,
  coffee: 300
};

// =========================
// SESSION STORE
// =========================
const sessions = {};

// =========================
// HELPERS
// =========================
function normalizeText(text = "") {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function formatMenu() {
  let text = "*JavaGoat Menu*\n\n";
  for (const [item, price] of Object.entries(MENU)) {
    text += `• ${item} - Rs. ${price}\n`;
  }
  text += "\nType:\n*order pizza*\n*order burger*\n*menu*\n*cancel*";
  return text;
}

function getMatchedItem(input) {
  const clean = normalizeText(input);

  if (MENU[clean]) return clean;

  const found = Object.keys(MENU).find((item) => normalizeText(item) === clean);
  return found || null;
}

function createSession(sender) {
  sessions[sender] = {
    step: "idle",
    cart: [],
    customerName: "",
    phone: "",
    address: "",
    notes: "",
    lastActivity: Date.now()
  };
  return sessions[sender];
}

function getSession(sender) {
  if (!sessions[sender]) return createSession(sender);
  sessions[sender].lastActivity = Date.now();
  return sessions[sender];
}

function clearSession(sender) {
  delete sessions[sender];
}

function calculateTotal(cart) {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function cartSummary(cart) {
  if (!cart.length) return "No items";
  return cart
    .map((item) => `• ${item.quantity}x ${item.name} = Rs. ${item.price * item.quantity}`)
    .join("\n");
}

function extractQuantityAndItem(rawText) {
  const text = normalizeText(rawText);

  // formats:
  // order pizza
  // order 2 pizza
  // order 3 fries
  let match = text.match(/^order\s+(\d+)\s+(.+)$/i);
  if (match) {
    return {
      quantity: parseInt(match[1], 10),
      itemName: match[2].trim()
    };
  }

  match = text.match(/^order\s+(.+)$/i);
  if (match) {
    return {
      quantity: 1,
      itemName: match[1].trim()
    };
  }

  return null;
}

async function saveOrderToFirebase(sender, session) {
  const total = calculateTotal(session.cart);

  const orderData = {
    userId: sender.replace(/[@:].*$/, ""),
    userEmail: "",
    whatsappNumber: sender,
    phone: session.phone,
    customerName: session.customerName,
    address: session.address,
    notes: session.notes || "",
    items: session.cart,
    total: total.toFixed(2),
    status: "Placed",
    method: "Cash on Delivery",
    source: "WhatsApp Bot",
    timestamp: new Date().toISOString()
  };

  const orderRef = db.ref("orders").push();
  await orderRef.set(orderData);

  await db.ref("notifications/admin").push({
    title: "New WhatsApp Order",
    body: `${session.customerName} placed an order worth Rs. ${total}`,
    orderId: orderRef.key,
    timestamp: Date.now(),
    read: false
  });

  return orderRef.key;
}

async function sendText(sock, jid, text) {
  await sock.sendMessage(jid, { text });
}

// =========================
// BOT START
// =========================
async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("QR code generated. Scan it from WhatsApp.");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        console.log("Bot connected successfully.");
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        console.log("Connection closed.");

        if (shouldReconnect) {
          console.log("Reconnecting...");
          startBot();
        } else {
          console.log("Logged out. Delete auth_info folder and login again.");
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        try {
          if (!msg.message || msg.key.fromMe) continue;

          const sender = msg.key.remoteJid;
          if (!sender || !sender.endsWith("@s.whatsapp.net")) continue;

          const rawText =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

          const text = normalizeText(rawText);
          if (!text) continue;

          console.log(`Message from ${sender}: ${text}`);

          const session = getSession(sender);

          // =========================
          // GLOBAL COMMANDS
          // =========================
          if (["hi", "hello", "start", "hey", "aoa", "assalamualaikum"].includes(text)) {
            clearSession(sender);
            createSession(sender);

            await sendText(
              sock,
              sender,
              `Welcome to *JavaGoat* 🍽️\n\n${formatMenu()}\n\nYou can also type:\n*cart* to view cart\n*checkout* to place order`
            );
            continue;
          }

          if (text === "menu") {
            await sendText(sock, sender, formatMenu());
            continue;
          }

          if (text === "cancel") {
            clearSession(sender);
            await sendText(
              sock,
              sender,
              "Your current order flow has been cancelled.\n\nType *menu* to start again."
            );
            continue;
          }

          if (text === "cart") {
            if (!session.cart.length) {
              await sendText(sock, sender, "Your cart is empty.\n\nType *menu* to see items.");
              continue;
            }

            await sendText(
              sock,
              sender,
              `*Your Cart*\n\n${cartSummary(session.cart)}\n\n*Total: Rs. ${calculateTotal(session.cart)}*\n\nType *checkout* to continue\nType *order pizza* to add more`
            );
            continue;
          }

          if (text === "checkout") {
            if (!session.cart.length) {
              await sendText(sock, sender, "Your cart is empty.\nType *menu* first.");
              continue;
            }

            session.step = "awaiting_name";
            await sendText(sock, sender, "Please send your *full name*.");
            continue;
          }

          // =========================
          // ORDER COMMAND
          // =========================
          if (text.startsWith("order ")) {
            const parsed = extractQuantityAndItem(text);

            if (!parsed) {
              await sendText(sock, sender, "Use this format:\n*order pizza*\nor\n*order 2 pizza*");
              continue;
            }

            const matchedItem = getMatchedItem(parsed.itemName);

            if (!matchedItem) {
              await sendText(
                sock,
                sender,
                `Sorry, *${parsed.itemName}* is not available.\n\n${formatMenu()}`
              );
              continue;
            }

            const quantity = parsed.quantity > 0 ? parsed.quantity : 1;
            const price = MENU[matchedItem];

            const existing = session.cart.find((i) => normalizeText(i.name) === matchedItem);
            if (existing) {
              existing.quantity += quantity;
            } else {
              session.cart.push({
                id: matchedItem.replace(/\s+/g, "_"),
                name: matchedItem,
                price,
                quantity
              });
            }

            session.step = "cart_ready";

            await sendText(
              sock,
              sender,
              `Added to cart ✅\n\n*${quantity}x ${matchedItem}*\nPrice: *Rs. ${price} each*\n\n${cartSummary(session.cart)}\n\n*Total: Rs. ${calculateTotal(session.cart)}*\n\nType *checkout* to continue\nType *menu* to add more items`
            );
            continue;
          }

          // =========================
          // MULTI-STEP ORDER FLOW
          // =========================
          if (session.step === "awaiting_name") {
            session.customerName = rawText.trim();
            session.step = "awaiting_phone";

            await sendText(sock, sender, "Please send your *phone number*.");
            continue;
          }

          if (session.step === "awaiting_phone") {
            session.phone = rawText.trim();
            session.step = "awaiting_address";

            await sendText(sock, sender, "Please send your *full delivery address*.");
            continue;
          }

          if (session.step === "awaiting_address") {
            session.address = rawText.trim();
            session.step = "awaiting_notes";

            await sendText(
              sock,
              sender,
              "Any extra notes?\n\nExamples:\n• no onions\n• call before delivery\n\nType *skip* if none."
            );
            continue;
          }

          if (session.step === "awaiting_notes") {
            session.notes = text === "skip" ? "" : rawText.trim();
            session.step = "awaiting_confirmation";

            await sendText(
              sock,
              sender,
              `*Please confirm your order*\n\n` +
                `Name: ${session.customerName}\n` +
                `Phone: ${session.phone}\n` +
                `Address: ${session.address}\n` +
                `Notes: ${session.notes || "None"}\n\n` +
                `${cartSummary(session.cart)}\n\n` +
                `*Grand Total: Rs. ${calculateTotal(session.cart)}*\n\n` +
                `Type *confirm* to place order\nType *cancel* to stop`
            );
            continue;
          }

          if (session.step === "awaiting_confirmation") {
            if (text === "confirm") {
              const orderId = await saveOrderToFirebase(sender, session);

              await sendText(
                sock,
                sender,
                `Order placed successfully ✅\n\nOrder ID: *${orderId.substring(1, 7).toUpperCase()}*\nTotal: *Rs. ${calculateTotal(session.cart)}*\n\nThank you for ordering from *JavaGoat*.\nYou will be contacted soon.`
              );

              clearSession(sender);
              continue;
            }

            await sendText(
              sock,
              sender,
              "Please type *confirm* to place your order or *cancel* to stop."
            );
            continue;
          }

          // =========================
          // QUICK SINGLE-WORD ITEM SUPPORT
          // =========================
          const directItem = getMatchedItem(text);
          if (directItem) {
            const price = MENU[directItem];
            const existing = session.cart.find((i) => normalizeText(i.name) === directItem);

            if (existing) {
              existing.quantity += 1;
            } else {
              session.cart.push({
                id: directItem.replace(/\s+/g, "_"),
                name: directItem,
                price,
                quantity: 1
              });
            }

            session.step = "cart_ready";

            await sendText(
              sock,
              sender,
              `Added *${directItem}* to cart ✅\n\n${cartSummary(session.cart)}\n\n*Total: Rs. ${calculateTotal(session.cart)}*\n\nType *checkout* to continue`
            );
            continue;
          }

          // =========================
          // FALLBACK
          // =========================
          await sendText(
            sock,
            sender,
            `🤔 I didn't quite catch that.\n\nType *menu* to see our food list.\nType *order pizza* to place an order.\nType *cart* to see your cart.\nType *checkout* to continue.`
          );
        } catch (err) {
          console.error("Message handling error:", err);
        }
      }
    });
  } catch (error) {
    console.error("Bot start error:", error);
  }
}

startBot();
