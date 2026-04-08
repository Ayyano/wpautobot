sock.ev.on("messages.upsert", async ({ messages, type }) => {
  if (type !== "notify") return;

  const msg = messages[0];
  if (!msg.message) return;

  const sender = msg.key.remoteJid;
  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    "";

  const message = text.trim().toLowerCase();

  console.log(`Message from ${sender}: ${message}`);

  const menuItems = {
    "pizza": 1200,
    "burger": 850,
    "zinger burger": 950,
    "fries": 350,
    "shawarma": 500,
    "biryani": 700,
    "coffee": 300
  };

  if (message === "hi" || message === "hello" || message === "start") {
    await sock.sendMessage(sender, {
      text:
        "Welcome to JavaGoat\n\nType *menu* to see available food items.\nType *order item-name* to place an order.\n\nExample: *order pizza*"
    });
    return;
  }

  if (message === "menu") {
    let menuText = "*JavaGoat Menu*\n\n";
    Object.entries(menuItems).forEach(([name, price]) => {
      menuText += `• ${name} - Rs. ${price}\n`;
    });
    menuText += "\nTo order, type: *order pizza*";
    await sock.sendMessage(sender, { text: menuText });
    return;
  }

  if (message.startsWith("order ")) {
    const itemName = message.replace("order ", "").trim();

    if (!itemName) {
      await sock.sendMessage(sender, {
        text: "Please type an item name.\nExample: *order pizza*"
      });
      return;
    }

    const matchedItem = Object.keys(menuItems).find(
      (item) => item.toLowerCase() === itemName
    );

    if (!matchedItem) {
      await sock.sendMessage(sender, {
        text:
          `Sorry, *${itemName}* is not available.\n\nType *menu* to see available items.`
      });
      return;
    }

    const price = menuItems[matchedItem];

    await sock.sendMessage(sender, {
      text:
        `Order confirmed\n\nItem: *${matchedItem}*\nPrice: *Rs. ${price}*\n\nReply with your *name, address, and phone number* to complete the order.`
    });

    return;
  }

  await sock.sendMessage(sender, {
    text:
      "🤔 I didn't quite catch that.\n\nType *menu* to see our food list, or *order [food]* to place an order!\n\nExample: *order pizza*"
  });
});
