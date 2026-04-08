const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const admin = require("firebase-admin");

// Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://gen-lang-client-0120793291-default-rtdb.firebaseio.com"
});

const db = admin.database();

// In-memory session state
const userSessions = {};

async function startBot() {
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
      console.log("Scan this QR:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("WhatsApp bot connected");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log("Connection closed");

      if (shouldReconnect) {
        startBot();
      } else {
        console.log("Logged out. Delete auth_info and login again.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const sender = msg.key.remoteJid;
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      const message = text.trim().toLowerCase();
      if (!message) continue;

      console.log("Incoming:", sender, message);

      const menuItems = {
        pizza: 1200,
        burger: 850,
        "zinger burger": 950,
        fries: 350,
       
